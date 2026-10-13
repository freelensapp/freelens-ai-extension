import { describe, expect, it } from "vitest";
import {
  type AiMessageChunk,
  createStreamMergeState,
  extractReasoningText,
  flattenContentText,
  hasFinishSignal,
  mergeAiChunk,
  streamBoundaryKey,
} from "./stream-merge";

import type { MessageContent } from "@langchain/core/messages";

const chunk = (id: string | undefined, content: MessageContent, extra: Partial<AiMessageChunk> = {}): AiMessageChunk =>
  ({ id, content, ...extra }) satisfies AiMessageChunk;

// LangGraph tags every streamed chunk with the checkpoint namespace of the node
// execution that produced it.
const nodeMetadata = (checkpointNamespace: string) => ({ langgraph_checkpoint_ns: checkpointNamespace });

const finished = { response_metadata: { finish_reason: "stop" } };

describe("mergeAiChunk", () => {
  it("concatenates chunks of the same message without a separator", () => {
    const state = createStreamMergeState();
    const node = nodeMetadata("conclusionsAgent:1");
    expect(mergeAiChunk(state, chunk("msg-1", "Everything is "), node)).toBe("Everything is ");
    expect(mergeAiChunk(state, chunk("msg-1", "working fine."), node)).toBe("working fine.");
  });

  it("concatenates a gateway stream that mints a fresh id for every chunk", () => {
    // LiteLLM proxying ollama_chat: each SSE chunk carries a different id and no
    // finish signal until the end. Treating the id change as a boundary rendered
    // one word per Markdown paragraph.
    const state = createStreamMergeState();
    const node = nodeMetadata("generalPurposeAgent:1");
    expect(mergeAiChunk(state, chunk("chatcmpl-1", "Everything "), node)).toBe("Everything ");
    expect(mergeAiChunk(state, chunk("chatcmpl-2", "is "), node)).toBe("is ");
    expect(mergeAiChunk(state, chunk("chatcmpl-3", "working "), node)).toBe("working ");
    expect(mergeAiChunk(state, chunk("chatcmpl-4", "fine.", finished), node)).toBe("fine.");
  });

  it("inserts a blank line when the next node execution emits a new message", () => {
    const state = createStreamMergeState();
    mergeAiChunk(state, chunk("msg-1", "Everything is working fine."), nodeMetadata("kubernetesOperator:1|agent:7"));
    expect(mergeAiChunk(state, chunk("msg-2", "### Summary"), nodeMetadata("kubernetesOperator:1|agent:9"))).toBe(
      "\n\n### Summary",
    );
  });

  it("separates on the node boundary even when the gateway reuses the id", () => {
    const state = createStreamMergeState();
    mergeAiChunk(state, chunk("same-id", "Checked the pods."), nodeMetadata("agentAnalyzer:1"));
    expect(mergeAiChunk(state, chunk("same-id", "### Summary"), nodeMetadata("conclusionsAgent:4"))).toBe(
      "\n\n### Summary",
    );
  });

  it("separates on the node and step pair when no checkpoint namespace is sent", () => {
    const state = createStreamMergeState();
    mergeAiChunk(state, chunk("msg-1", "Working."), { langgraph_node: "agent", langgraph_step: 1 });
    expect(mergeAiChunk(state, chunk("msg-2", "### Summary"), { langgraph_node: "agent", langgraph_step: 3 })).toBe(
      "\n\n### Summary",
    );
  });

  it("separates a new id once the previous message reported a finish reason", () => {
    // OpenAI-style stream without LangGraph metadata: one id per completion, and
    // a final chunk carrying finish_reason.
    const state = createStreamMergeState();
    expect(mergeAiChunk(state, chunk("msg-1", "Everything is "))).toBe("Everything is ");
    expect(mergeAiChunk(state, chunk("msg-1", "working fine.", finished))).toBe("working fine.");
    expect(mergeAiChunk(state, chunk("msg-2", "### Summary"))).toBe("\n\n### Summary");
  });

  it("records the finish signal carried by an empty final chunk", () => {
    // OpenAI sends finish_reason on a chunk whose content delta is empty; the
    // signal must survive the empty-chunk shortcut.
    const state = createStreamMergeState();
    mergeAiChunk(state, chunk("msg-1", "Everything is working fine."));
    expect(mergeAiChunk(state, chunk("msg-1", "", finished))).toBe("");
    expect(mergeAiChunk(state, chunk("msg-2", "### Summary"))).toBe("\n\n### Summary");
  });

  it("does not separate on an id change while no boundary signal is available", () => {
    // Provider sends neither LangGraph metadata nor a finish reason: degrade to
    // concatenation rather than to a paragraph per token.
    const state = createStreamMergeState();
    expect(mergeAiChunk(state, chunk("chatcmpl-1", "Everything "))).toBe("Everything ");
    expect(mergeAiChunk(state, chunk("chatcmpl-2", "is "))).toBe("is ");
    expect(mergeAiChunk(state, chunk("chatcmpl-3", "working fine."))).toBe("working fine.");
  });

  it("ignores an explicit null finish_reason sent on every intermediate chunk", () => {
    const state = createStreamMergeState();
    mergeAiChunk(state, chunk("chatcmpl-1", "Everything ", { response_metadata: { finish_reason: null } }));
    expect(mergeAiChunk(state, chunk("chatcmpl-2", "is working fine."))).toBe("is working fine.");
  });

  it("reads the finish signal from additional_kwargs", () => {
    const state = createStreamMergeState();
    mergeAiChunk(state, chunk("msg-1", "Done.", { additional_kwargs: { finish_reason: "stop" } }));
    expect(mergeAiChunk(state, chunk("msg-2", "### Summary"))).toBe("\n\n### Summary");
  });

  it("does not prepend a separator before the very first chunk", () => {
    const state = createStreamMergeState();
    expect(mergeAiChunk(state, chunk("msg-1", "### Summary"), nodeMetadata("conclusionsAgent:1"))).toBe("### Summary");
  });

  it("ignores empty chunks and leaves the boundary state untouched", () => {
    const state = createStreamMergeState();
    mergeAiChunk(state, chunk("msg-1", "Hello"), nodeMetadata("agent:1"));
    expect(mergeAiChunk(state, chunk("msg-2", ""), nodeMetadata("agent:2"))).toBe("");
    // The empty chunk must not consume the boundary: the next real chunk from a
    // new message still gets its separator.
    expect(mergeAiChunk(state, chunk("msg-2", "World"), nodeMetadata("agent:2"))).toBe("\n\nWorld");
  });

  it("does not separate when ids are missing (preserves token streaming)", () => {
    const state = createStreamMergeState();
    expect(mergeAiChunk(state, chunk(undefined, "Hello "))).toBe("Hello ");
    expect(mergeAiChunk(state, chunk(undefined, "world"))).toBe("world");
  });

  it("handles three distinct node executions in a row", () => {
    const state = createStreamMergeState();
    expect(mergeAiChunk(state, chunk("a", "First."), nodeMetadata("agent:1"))).toBe("First.");
    expect(mergeAiChunk(state, chunk("b", "Second."), nodeMetadata("agent:2"))).toBe("\n\nSecond.");
    expect(mergeAiChunk(state, chunk("c", "Third."), nodeMetadata("agent:3"))).toBe("\n\nThird.");
  });

  it("flattens structured content arrays to their text", () => {
    const state = createStreamMergeState();
    expect(
      mergeAiChunk(
        state,
        chunk("msg-1", [
          { type: "text", text: "I'll investigate " },
          { type: "text", text: "now." },
        ]),
      ),
    ).toBe("I'll investigate now.");
  });

  it("emits the preamble text of a chunk that also carries a tool call", () => {
    const state = createStreamMergeState();
    // A chunk where the assistant wrote a preamble and then invoked a tool: the
    // tool-call lives outside `content`, so only the preamble text is emitted.
    expect(
      mergeAiChunk(
        state,
        chunk("msg-1", [
          { type: "text", text: "Good morning! I'll search the cluster." },
          { type: "tool_use", id: "call_1", name: "read_logs", input: { pod: "foo" } },
        ]),
      ),
    ).toBe("Good morning! I'll search the cluster.");
  });

  it("yields nothing for a tool-only chunk with no text", () => {
    const state = createStreamMergeState();
    expect(
      mergeAiChunk(state, chunk("msg-1", [{ type: "tool_use", id: "call_1", name: "read_logs", input: {} }])),
    ).toBe("");
  });
});

describe("streamBoundaryKey", () => {
  it("prefers the checkpoint namespace of the node execution", () => {
    expect(
      streamBoundaryKey({
        langgraph_checkpoint_ns: "conclusionsAgent:abc",
        checkpoint_ns: "other",
        langgraph_node: "conclusionsAgent",
        langgraph_step: 4,
      }),
    ).toBe("conclusionsAgent:abc");
  });

  it("falls back to checkpoint_ns, then to the node and step pair", () => {
    expect(streamBoundaryKey({ checkpoint_ns: "agent:xyz" })).toBe("agent:xyz");
    expect(streamBoundaryKey({ langgraph_node: "agent", langgraph_step: 2 })).toBe("agent:2");
    expect(streamBoundaryKey({ langgraph_node: "agent" })).toBe("agent");
  });

  it("returns undefined without usable metadata", () => {
    expect(streamBoundaryKey(undefined)).toBeUndefined();
    expect(streamBoundaryKey({})).toBeUndefined();
    expect(streamBoundaryKey({ checkpoint_ns: "" })).toBeUndefined();
    expect(streamBoundaryKey({ langgraph_node: 42 })).toBeUndefined();
  });
});

describe("hasFinishSignal", () => {
  it("detects a finish reason in either metadata record", () => {
    expect(hasFinishSignal({ content: "", response_metadata: { finish_reason: "stop" } })).toBe(true);
    expect(hasFinishSignal({ content: "", additional_kwargs: { finish_reason: "tool_calls" } })).toBe(true);
  });

  it("ignores a missing, null, or empty finish reason", () => {
    expect(hasFinishSignal({ content: "" })).toBe(false);
    expect(hasFinishSignal({ content: "", response_metadata: { finish_reason: null } })).toBe(false);
    expect(hasFinishSignal({ content: "", response_metadata: { finish_reason: "" } })).toBe(false);
  });
});

describe("flattenContentText", () => {
  it("returns string content unchanged", () => {
    expect(flattenContentText("hello")).toBe("hello");
  });

  it("joins the text parts of an array and ignores non-text parts", () => {
    expect(
      flattenContentText([
        { type: "text", text: "a" },
        { type: "image_url", image_url: { url: "x" } },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });

  it("returns an empty string when there is no text", () => {
    expect(flattenContentText([{ type: "tool_use", id: "1", name: "t", input: {} }])).toBe("");
  });

  it("skips reasoning and thinking parts so chain-of-thought never leaks into the answer", () => {
    expect(
      flattenContentText([
        { type: "reasoning", text: "Let me think..." },
        { type: "text", text: "The answer is 42." },
        { type: "thinking", text: "more thoughts" },
      ]),
    ).toBe("The answer is 42.");
  });
});

describe("extractReasoningText", () => {
  it("reads reasoning_content from additional_kwargs", () => {
    expect(extractReasoningText("", { reasoning_content: "Step 1: think." })).toBe("Step 1: think.");
  });

  it("falls back to the reasoning key in additional_kwargs", () => {
    expect(extractReasoningText("", { reasoning: "thinking..." })).toBe("thinking...");
  });

  it("reads reasoning_content from response_metadata when additional_kwargs has none", () => {
    expect(extractReasoningText("", undefined, { reasoning_content: "from metadata" })).toBe("from metadata");
  });

  it("reads reasoning_content sitting directly on the message object", () => {
    expect(extractReasoningText("the answer", undefined, undefined, { reasoning_content: "direct reasoning" })).toBe(
      "direct reasoning",
    );
  });

  it("uses the first source that carries reasoning so a delta is never counted twice", () => {
    expect(
      extractReasoningText(
        "",
        { reasoning_content: "from kwargs" },
        { reasoning_content: "from metadata" },
        { reasoning_content: "from message" },
      ),
    ).toBe("from kwargs");
  });

  it("reads the text of an object-shaped reasoning value", () => {
    expect(extractReasoningText("", { reasoning: { text: "nested thought" } })).toBe("nested thought");
  });

  it("collects reasoning and thinking content parts", () => {
    expect(
      extractReasoningText([
        { type: "reasoning", text: "first " },
        { type: "text", text: "the answer" },
        { type: "thinking", text: "second" },
      ]),
    ).toBe("first second");
  });

  it("reads the reasoning key of a content part when text is absent", () => {
    expect(extractReasoningText([{ type: "reasoning", reasoning: "from reasoning key" }])).toBe("from reasoning key");
  });

  it("returns an empty string when there is no reasoning", () => {
    expect(extractReasoningText("just an answer", { foo: "bar" })).toBe("");
    expect(extractReasoningText([{ type: "text", text: "answer" }])).toBe("");
    expect(extractReasoningText("answer")).toBe("");
  });
});
