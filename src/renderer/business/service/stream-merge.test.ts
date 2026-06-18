import { describe, expect, it } from "vitest";
import { createStreamMergeState, mergeAiChunk } from "./stream-merge";

describe("mergeAiChunk", () => {
  it("concatenates chunks of the same message without a separator", () => {
    const state = createStreamMergeState();
    expect(mergeAiChunk(state, "msg-1", "Everything is ")).toBe("Everything is ");
    expect(mergeAiChunk(state, "msg-1", "working fine.")).toBe("working fine.");
  });

  it("inserts a blank line when a new message begins", () => {
    const state = createStreamMergeState();
    mergeAiChunk(state, "msg-1", "Everything is working fine.");
    expect(mergeAiChunk(state, "msg-2", "### Summary")).toBe("\n\n### Summary");
  });

  it("does not prepend a separator before the very first chunk", () => {
    const state = createStreamMergeState();
    expect(mergeAiChunk(state, "msg-1", "### Summary")).toBe("### Summary");
  });

  it("ignores empty chunks and leaves the boundary state untouched", () => {
    const state = createStreamMergeState();
    mergeAiChunk(state, "msg-1", "Hello");
    expect(mergeAiChunk(state, "msg-2", "")).toBe("");
    // The empty chunk must not consume the boundary: the next real chunk from a
    // new message still gets its separator.
    expect(mergeAiChunk(state, "msg-2", "World")).toBe("\n\nWorld");
  });

  it("does not separate when ids are missing (preserves token streaming)", () => {
    const state = createStreamMergeState();
    expect(mergeAiChunk(state, undefined, "Hello ")).toBe("Hello ");
    expect(mergeAiChunk(state, undefined, "world")).toBe("world");
  });

  it("separates when the first message has no id but the next one does", () => {
    const state = createStreamMergeState();
    expect(mergeAiChunk(state, undefined, "Everything is working fine.")).toBe("Everything is working fine.");
    expect(mergeAiChunk(state, "msg-2", "### Summary")).toBe("\n\n### Summary");
  });

  it("handles three distinct messages in a row", () => {
    const state = createStreamMergeState();
    expect(mergeAiChunk(state, "a", "First.")).toBe("First.");
    expect(mergeAiChunk(state, "b", "Second.")).toBe("\n\nSecond.");
    expect(mergeAiChunk(state, "c", "Third.")).toBe("\n\nThird.");
  });
});
