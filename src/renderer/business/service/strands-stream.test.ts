import { describe, expect, it } from "vitest";
import {
  createStrandsStreamState,
  interleaveSideChannel,
  isApprovalChunk,
  isContextSizeChunk,
  isReasoningChunk,
  isTokenUsageChunk,
  mapAgentStreamEvent,
  SideChannel,
} from "./strands-stream";

const modelEvent = (event: object) => ({ type: "modelStreamUpdateEvent", event });
const text = (value: string) =>
  modelEvent({ type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: value } });
const messageStart = modelEvent({ type: "modelMessageStartEvent", role: "assistant" });

describe("mapAgentStreamEvent", () => {
  it("emits text deltas as plain strings", () => {
    const state = createStrandsStreamState();
    expect(mapAgentStreamEvent(state, messageStart)).toEqual([]);
    expect(mapAgentStreamEvent(state, text("Hel"))).toEqual(["Hel"]);
    expect(mapAgentStreamEvent(state, text("lo"))).toEqual(["lo"]);
  });

  it("separates consecutive assistant messages with a blank line", () => {
    const state = createStrandsStreamState();
    mapAgentStreamEvent(state, messageStart);
    mapAgentStreamEvent(state, text("Working."));
    mapAgentStreamEvent(state, messageStart);
    expect(mapAgentStreamEvent(state, text("### Summary"))).toEqual(["\n\n### Summary"]);
    expect(mapAgentStreamEvent(state, text(" done"))).toEqual([" done"]);
  });

  it("does not prefix the first message of a run", () => {
    const state = createStrandsStreamState();
    mapAgentStreamEvent(state, messageStart);
    mapAgentStreamEvent(state, messageStart);
    expect(mapAgentStreamEvent(state, text("First"))).toEqual(["First"]);
  });

  it("emits reasoning deltas as reasoning chunks", () => {
    const state = createStrandsStreamState();
    const event = modelEvent({
      type: "modelContentBlockDeltaEvent",
      delta: { type: "reasoningContentDelta", text: "hmm" },
    });
    expect(mapAgentStreamEvent(state, event)).toEqual([{ reasoning: "hmm" }]);
  });

  it("ignores tool-use input deltas and empty text", () => {
    const state = createStrandsStreamState();
    const toolInput = modelEvent({
      type: "modelContentBlockDeltaEvent",
      delta: { type: "toolUseInputDelta", input: "{}" },
    });
    expect(mapAgentStreamEvent(state, toolInput)).toEqual([]);
    expect(mapAgentStreamEvent(state, text(""))).toEqual([]);
  });

  it("turns usage metadata into a usage delta and a context size reading", () => {
    const state = createStrandsStreamState();
    const first = modelEvent({
      type: "modelMetadataEvent",
      usage: { inputTokens: 300, outputTokens: 20, cacheReadInputTokens: 100 },
    });
    const second = modelEvent({ type: "modelMetadataEvent", usage: { inputTokens: 200, outputTokens: 50 } });
    expect(mapAgentStreamEvent(state, first)).toEqual([
      { tokenUsage: { input: 300, cached: 100, output: 20 } },
      { contextTokens: 320, peakInputTokens: 300 },
    ]);
    expect(mapAgentStreamEvent(state, second)).toEqual([
      { tokenUsage: { input: 200, cached: 0, output: 50 } },
      { contextTokens: 250, peakInputTokens: 300 },
    ]);
    expect(state.sawUsage).toBe(true);
  });

  it("skips empty usage", () => {
    const state = createStrandsStreamState();
    const event = modelEvent({ type: "modelMetadataEvent", usage: { inputTokens: 0, outputTokens: 0 } });
    expect(mapAgentStreamEvent(state, event)).toEqual([]);
    expect(state.sawUsage).toBe(false);
  });

  it("surfaces approval interrupts with their id", () => {
    const state = createStrandsStreamState();
    const approval = {
      question: "q",
      options: ["yes", "no"],
      actionToApprove: { action: "DELETE POD" },
      requestString: "r",
    };
    const event: { type: string } = {
      type: "interruptEvent",
      interrupt: { id: "tool:1:freelens-approval", reason: approval },
    } as { type: string };
    expect(mapAgentStreamEvent(state, event)).toEqual([{ interruptId: "tool:1:freelens-approval", approval }]);
  });

  it("ignores interrupts that are not approval requests and unrelated events", () => {
    const state = createStrandsStreamState();
    const other = { type: "interruptEvent", interrupt: { id: "x", reason: "other" } };
    expect(mapAgentStreamEvent(state, other)).toEqual([]);
    expect(mapAgentStreamEvent(state, { type: "beforeToolCallEvent" })).toEqual([]);
  });
});

describe("chunk guards", () => {
  it("recognize each chunk kind", () => {
    expect(isReasoningChunk({ reasoning: "r" })).toBe(true);
    expect(isReasoningChunk("text")).toBe(false);
    expect(isTokenUsageChunk({ tokenUsage: { input: 1, cached: 0, output: 1 } })).toBe(true);
    expect(isContextSizeChunk({ contextTokens: 1, peakInputTokens: 1 })).toBe(true);
    expect(isApprovalChunk({ interruptId: "i", approval: {} })).toBe(true);
    expect(isApprovalChunk({ reasoning: "r" })).toBe(false);
  });
});

describe("interleaveSideChannel", () => {
  const collect = async <T>(iterable: AsyncIterable<T>) => {
    const items: T[] = [];
    for await (const item of iterable) {
      items.push(item);
    }
    return items;
  };

  it("yields side items before the source item that follows them", async () => {
    const side = new SideChannel<string>();
    async function* source() {
      side.push("thinking");
      yield "answer";
    }
    expect(await collect(interleaveSideChannel(source(), side))).toEqual([{ side: "thinking" }, { source: "answer" }]);
  });

  it("streams side items while the source is still waiting", async () => {
    const side = new SideChannel<string>();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* source() {
      await gate;
      yield "answer";
    }
    const iterator = interleaveSideChannel(source(), side)[Symbol.asyncIterator]();
    const next = iterator.next();
    side.push("live");
    expect(await next).toEqual({ done: false, value: { side: "live" } });
    release();
    expect(await iterator.next()).toEqual({ done: false, value: { source: "answer" } });
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  it("propagates source errors", async () => {
    const side = new SideChannel<string>();
    async function* source(): AsyncGenerator<string> {
      yield* [];
      throw new Error("boom");
    }
    await expect(collect(interleaveSideChannel(source(), side))).rejects.toThrow("boom");
  });
});
