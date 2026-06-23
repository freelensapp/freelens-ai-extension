import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { Command, Interrupt } from "@langchain/langgraph";
import { FreeLensAgent } from "../agent/freelens-agent-system";
import { MPCAgent } from "../agent/mcp-agent";
import { approximateMessagesTokenCount } from "../provider/token-estimate";
import { createStreamMergeState, extractReasoningText, mergeAiChunk } from "./stream-merge";
import { addTokenUsage, emptyTokenUsage, extractTokenUsageFromLLMResult, type TokenUsage } from "./token-usage";

import type { LLMResult } from "@langchain/core/outputs";

const MAX_GEMINI_STREAM_RETRIES = 3;
const BASE_BACKOFF_MS = 700;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isGeminiTransientError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("failed to parse stream") ||
    message.includes("503") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("429") ||
    message.includes("too many requests")
  );
};

const getRetryDelay = (attempt: number) => {
  const jitter = Math.floor(Math.random() * 250);

  return BASE_BACKOFF_MS * 2 ** (attempt - 1) + jitter;
};

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

// A streamed chunk carrying the token usage accumulated across the run. The chat
// service sums these into the per-session counter shown in the UI. Emitted once
// at end of turn so a transient-error retry can discard the failed attempt's
// usage rather than double counting it.
export interface TokenUsageChunk {
  tokenUsage: TokenUsage;
}

export const isTokenUsageChunk = (chunk: unknown): chunk is TokenUsageChunk =>
  typeof chunk === "object" && chunk !== null && "tokenUsage" in chunk;

// A streamed chunk carrying the size of the persisted conversation that the next
// prompt re-sends. `contextTokens` (parent-thread messages, ~4 chars/token)
// drives the capacity indicator and the compaction decision; unlike a single
// call's input it excludes the transient tool-loop context of the sub-agents,
// which never persists. `peakInputTokens` is the largest single LLM call's input
// in the run - surfaced only in the indicator tooltip, never used to size the
// gauge or trigger compaction. Emitted live, once per completed LLM call, so the
// indicator moves during a turn instead of only at the end.
export interface ContextSizeChunk {
  contextTokens: number;
  peakInputTokens: number;
}

export const isContextSizeChunk = (chunk: unknown): chunk is ContextSizeChunk =>
  typeof chunk === "object" && chunk !== null && "contextTokens" in chunk;

/**
 * Accumulates the token usage reported by every model turn in a run via the
 * `handleLLMEnd` callback. The callback fires for each LLM call - including the
 * supervisor and analyzer turns the graph suppresses from the `messages` stream
 * with the `nostream` tag - so the counter reflects the whole run, not just the
 * single visible (conclusions / operator) turn. Config callbacks propagate to
 * the sub-agents through the forwarded run config, so their turns are caught too.
 */
class TokenUsageCollector extends BaseCallbackHandler {
  name = "freelens-token-usage-collector";
  total: TokenUsage = emptyTokenUsage();
  // Largest single call's input tokens seen in the run. This is a transient
  // intra-turn spike (e.g. a sub-agent re-sending a big tool result) that does
  // not persist, so it never sizes the gauge or the compaction decision - it is
  // surfaced only in the indicator tooltip as "largest single request this turn".
  peakInputTokens = 0;
  // Incremented on every completed LLM call so the streaming loop can detect when
  // a new internal call finished and refresh the live persisted-context reading.
  callCount = 0;

  handleLLMEnd(output: LLMResult): void {
    const usage = extractTokenUsageFromLLMResult(output);
    if (usage) {
      this.total = addTokenUsage(this.total, usage);
      this.peakInputTokens = Math.max(this.peakInputTokens, usage.input);
      this.callCount += 1;
    }
  }
}

export interface AgentService {
  run(
    agentInput: object | Command,
    conversationId: string,
  ): AsyncGenerator<string | ReasoningChunk | TokenUsageChunk | ContextSizeChunk | Interrupt, void, unknown>;
}

/**
 * This service takes an agent, runs it and streams the response back to the caller.
 * If the agent has any interrupts, it will yield those as well.
 * @returns
 * @param agent
 */
export const useAgentService = (agent: FreeLensAgent | MPCAgent): AgentService => {
  const run = async function* (agentInput: object | Command, conversationId: string) {
    console.log("Starting Agent Service run for message: ", agentInput);

    let config = { thread_id: conversationId };
    for (let attempt = 1; attempt <= MAX_GEMINI_STREAM_RETRIES + 1; attempt++) {
      let hasYieldedContent = false;
      // Tracks assistant message boundaries so distinct messages emitted within a
      // single run are separated by a blank line instead of being glued together.
      const mergeState = createStreamMergeState();
      // Fresh per attempt so a transient-error retry discards the usage counted
      // for the failed attempt rather than double counting it.
      const tokenUsageCollector = new TokenUsageCollector();
      // Number of completed LLM calls already reflected in an emitted context
      // chunk, so the live reading is refreshed only when a new internal call
      // finishes rather than on every streamed token.
      let lastEmittedCallCount = 0;

      // Read the persisted parent-thread context size (what the next prompt
      // re-sends) and pair it with the run's peak single-call input for the
      // tooltip. The persisted thread grows as the graph's nodes check point, so
      // reading it after each completed call lets the indicator move during the
      // turn instead of only at the end.
      const readContextSize = async (): Promise<ContextSizeChunk> => {
        const state = await agent.getState({ configurable: config });
        return {
          contextTokens: approximateMessagesTokenCount(state?.values?.messages),
          peakInputTokens: tokenUsageCollector.peakInputTokens,
        };
      };

      try {
        const streamResponse = await agent.stream(agentInput, {
          streamMode: "messages",
          configurable: config,
          callbacks: [tokenUsageCollector],
        });

        // streams LLM token by token to the UI
        for await (const [message, _metadata] of streamResponse) {
          // Always emit the assistant's text content, even when the same chunk
          // also carries tool calls. Some providers (e.g. DeepSeek via
          // DsmlAwareChatOpenAI) deliver the preamble text and the tool call in
          // a single chunk; dropping the whole chunk would hide the preamble the
          // model wrote before invoking a tool. Tool-call arguments live in
          // `tool_call_chunks`, not in `content`, so they are never emitted here.
          if (message.getType() === "ai") {
            // Surface the model's reasoning before its answer text. Providers
            // expose it inconsistently: in `additional_kwargs`, in
            // `response_metadata`, or as a `reasoning_content` field sitting
            // directly on the message next to `content`. Pass all three so the
            // reasoning is found wherever the gateway puts it. It may stream
            // token by token or arrive alongside the answer; the UI concatenates
            // the deltas into a collapsible block.
            const reasoning = extractReasoningText(
              message.content,
              message.additional_kwargs,
              message.response_metadata,
              message as unknown as Record<string, unknown>,
            );
            if (reasoning.length > 0) {
              hasYieldedContent = true;
              yield { reasoning };
            }

            const text = mergeAiChunk(mergeState, message.id, message.content);
            if (text.length > 0) {
              hasYieldedContent = true;
              yield text;
            }
          }

          // Refresh the live capacity reading whenever a new internal LLM call
          // has finished, so the indicator moves during the turn rather than
          // only at the end (a single user turn fans out into several calls).
          if (tokenUsageCollector.callCount > lastEmittedCallCount) {
            lastEmittedCallCount = tokenUsageCollector.callCount;
            yield await readContextSize();
          }
        }

        yield "\n";

        // Final, authoritative capacity reading once the run has settled: the
        // persisted thread is now complete, so this is exactly what the next
        // prompt re-sends and what the pre-send compaction decision acts on.
        yield await readContextSize();

        // Emit the token usage accumulated across every model turn in this run
        // (collected from the `handleLLMEnd` callback above). Reading it from the
        // callback rather than the streamed chunks is what lets the supervisor
        // and analyzer turns - suppressed from the `messages` stream by the
        // `nostream` tag - be counted, not just the single visible turn. Emitted
        // once here (not per call) so a transient-error retry discards a failed
        // attempt's usage rather than double counting it.
        const tokenUsage = tokenUsageCollector.total;
        if (tokenUsage.input !== 0 || tokenUsage.cached !== 0 || tokenUsage.output !== 0) {
          yield { tokenUsage };
        }

        // checks the agent state for any interrupts
        const agentState = await agent.getState({ configurable: config });
        console.log("Agent state: ", agentState);
        if (agentState.next) {
          console.log("Agent state next: ", agentState.next);
          for (const task of agentState.tasks) {
            if (task.interrupts) {
              console.log("Agent state task interrupts: ", task.interrupts);
              for (const interrupt of task.interrupts) {
                console.log("Agent state task interrupt: ", interrupt);
                yield interrupt;
              }
            }
          }
        }

        return;
      } catch (error) {
        const canRetry = !hasYieldedContent && isGeminiTransientError(error) && attempt <= MAX_GEMINI_STREAM_RETRIES;

        if (!canRetry) {
          throw error;
        }

        await wait(getRetryDelay(attempt));
      }
    }
  };

  return { run };
};
