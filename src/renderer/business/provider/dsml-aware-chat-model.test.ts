import { AIMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DsmlAwareChatOpenAI } from "./dsml-aware-chat-model";

// Build a streamed chunk carrying the given assistant text.
const makeChunk = (content: string) =>
  new ChatGenerationChunk({ message: new AIMessageChunk({ content }), text: content });

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
});
