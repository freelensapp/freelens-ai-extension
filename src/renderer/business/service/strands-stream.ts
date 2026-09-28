// Maps the Strands agent stream onto the chunks the chat UI consumes: answer
// text, reasoning, token usage deltas, the context size gauge, and tool
// approval requests.
//
// Pure (structural event shapes, no SDK runtime or host dependencies) so the
// mapping is unit-tested directly (see strands-stream.test.ts).

import { type ApprovalRequest, isApprovalRequest } from "../agent/tools/approval";
import { isEmptyTokenUsage, type TokenUsage } from "./token-usage";

// A streamed chunk carrying the model's reasoning ("chain-of-thought"). Kept
// distinct from the plain-string answer chunks so the UI can render it in a
// separate, dimmed, collapsible block.
export interface ReasoningChunk {
  reasoning: string;
}

export const isReasoningChunk = (chunk: unknown): chunk is ReasoningChunk =>
  typeof chunk === "object" &&
  chunk !== null &&
  "reasoning" in chunk &&
  typeof (chunk as ReasoningChunk).reasoning === "string";

// A streamed chunk carrying token usage to add onto the per-session counter (and
// the cost derived from it) shown in the UI. Emitted live as a *delta* per
// completed model call, so the counter and cost move during a turn instead of
// only at the end (a single user turn loops through several calls when tools
// are used). The chat service simply sums every chunk.
export interface TokenUsageChunk {
  tokenUsage: TokenUsage;
}

export const isTokenUsageChunk = (chunk: unknown): chunk is TokenUsageChunk =>
  typeof chunk === "object" && chunk !== null && "tokenUsage" in chunk;

// A streamed chunk carrying the size of the conversation the next prompt
// re-sends. `contextTokens` is the last model call's input (system prompt, tool
// schemas and the whole history) plus its output, which is appended to the
// history: exactly what the next call starts from. It drives the capacity
// indicator and the compaction decision. `peakInputTokens` is the largest
// single call's input in the run - surfaced only in the indicator tooltip.
// Emitted live, once per completed model call.
export interface ContextSizeChunk {
  contextTokens: number;
  peakInputTokens: number;
}

export const isContextSizeChunk = (chunk: unknown): chunk is ContextSizeChunk =>
  typeof chunk === "object" && chunk !== null && "contextTokens" in chunk;

// A tool approval request raised by a write tool (or an MCP tool call). The run
// is paused until it is answered through `AgentService.resume`.
export interface ApprovalChunk {
  interruptId: string;
  approval: ApprovalRequest;
}

export const isApprovalChunk = (chunk: unknown): chunk is ApprovalChunk =>
  typeof chunk === "object" && chunk !== null && "approval" in chunk && "interruptId" in chunk;

export type AgentChunk = string | ReasoningChunk | TokenUsageChunk | ContextSizeChunk | ApprovalChunk;

// Structural views of the Strands events read here. Only the fields used are
// described, so tests can feed plain objects.
interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
}

interface ModelStreamEventLike {
  type: string;
  delta?: { type: string; text?: string };
  usage?: UsageLike;
}

interface ModelStreamUpdateEventLike {
  type: "modelStreamUpdateEvent";
  event: ModelStreamEventLike;
}

interface InterruptEventLike {
  type: "interruptEvent";
  interrupt: { id: string; reason?: unknown };
}

export interface StrandsStreamState {
  // Whether answer text was already emitted in this run.
  emittedText: boolean;
  // Set when a new assistant message starts after text was emitted, so the two
  // messages are separated by a blank line instead of being glued together.
  separateNextText: boolean;
  peakInputTokens: number;
  // Whether any model call in this run reported token usage.
  sawUsage: boolean;
}

export const createStrandsStreamState = (): StrandsStreamState => ({
  emittedText: false,
  separateNextText: false,
  peakInputTokens: 0,
  sawUsage: false,
});

const toCount = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const mapModelStreamEvent = (state: StrandsStreamState, event: ModelStreamEventLike): AgentChunk[] => {
  switch (event.type) {
    case "modelMessageStartEvent":
      if (state.emittedText) {
        state.separateNextText = true;
      }
      return [];
    case "modelContentBlockDeltaEvent": {
      const text = event.delta?.text;
      if (typeof text !== "string" || text.length === 0) {
        return [];
      }
      if (event.delta?.type === "reasoningContentDelta") {
        return [{ reasoning: text }];
      }
      if (event.delta?.type !== "textDelta") {
        return [];
      }
      const separator = state.separateNextText ? "\n\n" : "";
      state.separateNextText = false;
      state.emittedText = true;
      return [separator + text];
    }
    case "modelMetadataEvent": {
      if (!event.usage) {
        return [];
      }
      const input = toCount(event.usage.inputTokens);
      const output = toCount(event.usage.outputTokens);
      const tokenUsage: TokenUsage = { input, cached: toCount(event.usage.cacheReadInputTokens), output };
      if (isEmptyTokenUsage(tokenUsage)) {
        return [];
      }
      state.sawUsage = true;
      state.peakInputTokens = Math.max(state.peakInputTokens, input);
      return [{ tokenUsage }, { contextTokens: input + output, peakInputTokens: state.peakInputTokens }];
    }
    default:
      return [];
  }
};

/**
 * Translate one Strands agent stream event into zero or more UI chunks.
 */
export const mapAgentStreamEvent = (state: StrandsStreamState, event: { type: string }): AgentChunk[] => {
  if (event.type === "modelStreamUpdateEvent") {
    return mapModelStreamEvent(state, (event as ModelStreamUpdateEventLike).event);
  }
  if (event.type === "interruptEvent") {
    const { interrupt } = event as InterruptEventLike;
    if (isApprovalRequest(interrupt.reason)) {
      return [{ interruptId: interrupt.id, approval: interrupt.reason }];
    }
  }
  return [];
};

/**
 * A queue fed from outside the agent stream (the model's reasoning tap), with a
 * promise that settles as soon as an item is available.
 */
export class SideChannel<T> {
  private items: T[] = [];
  private notify: (() => void) | null = null;

  push(item: T): void {
    this.items.push(item);
    this.notify?.();
    this.notify = null;
  }

  // Resolves once at least one item is queued (immediately if already).
  ready(): Promise<void> {
    if (this.items.length > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.notify = resolve;
    });
  }

  drain(): T[] {
    const drained = this.items;
    this.items = [];
    return drained;
  }
}

/**
 * Yield the source items, interleaving the side-channel items as soon as they
 * arrive (and always before the next source item), so a long reasoning phase
 * streams live instead of waiting for the answer to start.
 */
export async function* interleaveSideChannel<T, S>(
  source: AsyncIterable<T>,
  side: SideChannel<S>,
): AsyncGenerator<{ source: T } | { side: S }> {
  const iterator = source[Symbol.asyncIterator]();
  let pending = iterator.next();
  while (true) {
    const winner = await Promise.race([
      pending.then((result) => ({ kind: "source" as const, result })),
      side.ready().then(() => ({ kind: "side" as const })),
    ]);
    for (const item of side.drain()) {
      yield { side: item };
    }
    if (winner.kind === "source") {
      if (winner.result.done) {
        return;
      }
      yield { source: winner.result.value };
      pending = iterator.next();
    }
  }
}
