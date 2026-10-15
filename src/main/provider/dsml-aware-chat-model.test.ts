import { AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DsmlAwareChatOpenAI, extractReasoningFromRawResponse } from "./dsml-aware-chat-model";

// Build a streamed chunk carrying the given assistant text, optionally with the
// raw OpenAI delta `__includeRawResponse` would attach (used to carry the
// DeepSeek-style `reasoning_content` that `@langchain/openai` otherwise drops).
const makeChunk = (content: string, reasoning?: string) =>
  new ChatGenerationChunk({
    message: new AIMessageChunk({
      content,
      additional_kwargs:
        reasoning === undefined
          ? undefined
          : { __raw_response: { choices: [{ delta: { reasoning_content: reasoning } }] } },
    }),
    text: content,
  });

// Drain an async generator into an array.
const collect = async (gen: AsyncGenerator<ChatGenerationChunk>) => {
  const chunks: ChatGenerationChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
};

const newModel = () => new DsmlAwareChatOpenAI({ apiKey: "sk-test", model: "deepseek-chat", streaming: true });

// Stub `ChatOpenAI.prototype._streamResponseChunks` (the `super` call) with the
// given upstream chunks and return the spy so the test can assert on its args.
const stubUpstream = (chunks: ChatGenerationChunk[]) =>
  vi.spyOn(ChatOpenAI.prototype as any, "_streamResponseChunks").mockImplementation(async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  });

// Minimal run manager exposing only the callback the override uses.
const newRunManager = () => {
  const handleLLMNewToken = vi.fn();
  return { runManager: { handleLLMNewToken } as any, handleLLMNewToken };
};

const run = (model: DsmlAwareChatOpenAI, runManager: any) =>
  collect(model._streamResponseChunks([], {} as any, runManager));

describe("DsmlAwareChatOpenAI._streamResponseChunks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suppresses upstream per-token callbacks and forwards a single cleaned chunk", async () => {
    const superSpy = stubUpstream([makeChunk("Hello, "), makeChunk("world")]);
    const { runManager, handleLLMNewToken } = newRunManager();

    const chunks = await run(newModel(), runManager);

    // The upstream call must drop the run manager so raw markup never streams.
    expect(superSpy).toHaveBeenCalledTimes(1);
    expect(superSpy.mock.calls[0][2]).toBeUndefined();

    // A single aggregated chunk is yielded and forwarded to the run manager
    // exactly once. This marks the run as "emitted" so a `nostream` supervisor
    // run does not crash in LangGraph's `handleLLMEnd`.
    expect(chunks).toHaveLength(1);
    expect(handleLLMNewToken).toHaveBeenCalledTimes(1);
    expect(handleLLMNewToken.mock.calls[0][0]).toBe("Hello, world");
    expect(handleLLMNewToken.mock.calls[0][5]).toMatchObject({ chunk: chunks[0] });
  });

  it("recovers DSML tool calls and forwards text without markup", async () => {
    const markup =
      '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="getNamespaces"></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>';
    stubUpstream([makeChunk(markup)]);
    const { runManager, handleLLMNewToken } = newRunManager();

    const chunks = await run(newModel(), runManager);

    expect(chunks).toHaveLength(1);
    expect((chunks[0].message as AIMessageChunk).tool_calls?.[0]?.name).toBe("getNamespaces");
    expect(handleLLMNewToken.mock.calls[0][0]).not.toContain("DSML");
  });

  it("does not touch the run manager for an empty upstream stream", async () => {
    stubUpstream([]);
    const { runManager, handleLLMNewToken } = newRunManager();

    const chunks = await run(newModel(), runManager);

    expect(chunks).toHaveLength(0);
    expect(handleLLMNewToken).not.toHaveBeenCalled();
  });

  it("salvages reasoning_content from the raw deltas onto the aggregated message", async () => {
    // `@langchain/openai` discards `reasoning_content` while converting deltas,
    // so the only copy survives on the raw response. The override must read it
    // back and re-attach it where the streaming consumer looks for it.
    stubUpstream([makeChunk("Restarting ", "I need to "), makeChunk("now.", "find the namespace.")]);
    const { runManager } = newRunManager();

    const chunks = await run(newModel(), runManager);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].message.additional_kwargs.reasoning_content).toBe("I need to find the namespace.");
    // The raw envelope is stripped so it never leaks downstream.
    expect(chunks[0].message.additional_kwargs.__raw_response).toBeUndefined();
  });

  it("leaves messages without reasoning untouched", async () => {
    stubUpstream([makeChunk("Plain answer")]);
    const { runManager } = newRunManager();

    const chunks = await run(newModel(), runManager);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].message.additional_kwargs.reasoning_content).toBeUndefined();
  });
});

describe("extractReasoningFromRawResponse", () => {
  it("reads reasoning_content from a streamed delta", () => {
    expect(
      extractReasoningFromRawResponse({ __raw_response: { choices: [{ delta: { reasoning_content: "thinking" } }] } }),
    ).toBe("thinking");
  });

  it("reads reasoning_content from a non-streamed message", () => {
    expect(
      extractReasoningFromRawResponse({ __raw_response: { choices: [{ message: { reasoning_content: "done" } }] } }),
    ).toBe("done");
  });

  it("falls back to the reasoning key when reasoning_content is absent", () => {
    expect(extractReasoningFromRawResponse({ __raw_response: { choices: [{ delta: { reasoning: "alt" } }] } })).toBe(
      "alt",
    );
  });

  it("returns an empty string when there is no raw response or no reasoning", () => {
    expect(extractReasoningFromRawResponse(undefined)).toBe("");
    expect(extractReasoningFromRawResponse({})).toBe("");
    expect(extractReasoningFromRawResponse({ __raw_response: { choices: [{ delta: {} }] } })).toBe("");
    expect(extractReasoningFromRawResponse({ __raw_response: { choices: [] } })).toBe("");
  });

  it("ignores non-string reasoning values", () => {
    expect(
      extractReasoningFromRawResponse({
        __raw_response: { choices: [{ delta: { reasoning_content: { text: "x" } } }] },
      }),
    ).toBe("");
  });
});
