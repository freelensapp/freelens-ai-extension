import { Main } from "@freelensapp/extensions";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AIProviders } from "../../common/provider/ai-models";
import { PreferencesStore } from "../../common/store";
import { flattenContentText } from "../agents/stream-merge";
import { resolveOpenAIKey, useModelProvider } from "./model-provider";

const preferences = () => PreferencesStore.getInstanceOrCreate<PreferencesStore>();

// A chat completion as an OpenAI-compatible endpoint answers it.
const completion = () =>
  new Response(
    JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 0,
      model: "gpt-4.1",
      choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

// A response of the Responses API with the given output items.
const responsesAnswer = (output: Record<string, unknown>[]) =>
  new Response(
    JSON.stringify({
      id: "resp_1",
      object: "response",
      created_at: 0,
      model: "gpt-6.1-sol",
      status: "completed",
      output,
      usage: {
        input_tokens: 3,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 1,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 4,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

beforeEach(() => {
  PreferencesStore.resetInstance();
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.mocked(Main.Util.fetch).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveOpenAIKey", () => {
  it("prefers OPENAI_API_KEY of main's environment", () => {
    vi.stubEnv("OPENAI_API_KEY", " env-key ");
    preferences().openAIKey = "preferences-key";

    expect(resolveOpenAIKey(preferences())).toBe("env-key");
  });

  it("falls back to the key of the preferences", () => {
    preferences().openAIKey = " preferences-key ";

    expect(resolveOpenAIKey(preferences())).toBe("preferences-key");
  });

  it("is undefined when neither has a key", () => {
    preferences().openAIKey = "  ";

    expect(resolveOpenAIKey(preferences())).toBeUndefined();
  });
});

describe("useModelProvider().getModel", () => {
  it("throws without a selected model", () => {
    preferences().selectedModel = "";

    expect(() => useModelProvider().getModel()).toThrow("No model selected.");
  });

  it("throws without a key", () => {
    preferences().openAIKey = "";

    expect(() => useModelProvider().getModel()).toThrow("No API key configured.");
  });

  it("sends the model's requests through the host's fetch, to the base URL, with the key", async () => {
    vi.mocked(Main.Util.fetch).mockImplementation(async () => completion() as never);
    preferences().openAIKey = "preferences-key";
    preferences().openAIBaseUrl = "http://litellm.local:4000/v1";
    preferences().models = [{ provider: AIProviders.OPEN_AI, name: "gpt-4.1" }];
    preferences().selectedModel = "gpt-4.1";

    const answer = await useModelProvider()
      .getModel()
      .invoke([new HumanMessage("ping")]);

    expect(answer.content).toBe("pong");
    expect(Main.Util.fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(Main.Util.fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("http://litellm.local:4000/v1/chat/completions");
    expect(new Headers(init?.headers as HeadersInit).get("authorization")).toBe("Bearer preferences-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "gpt-4.1", temperature: 0 });
  });

  it("runs the tool loop of a GPT-6 model through the Responses API without storing it", async () => {
    vi.mocked(Main.Util.fetch)
      .mockImplementationOnce(
        async () =>
          responsesAnswer([
            { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "encrypted-reasoning" },
            {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "getNamespaces",
              arguments: "{}",
              status: "completed",
            },
          ]) as never,
      )
      .mockImplementationOnce(
        async () =>
          responsesAnswer([
            {
              type: "message",
              id: "msg_1",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "integration-tests", annotations: [] }],
            },
          ]) as never,
      );
    preferences().openAIKey = "preferences-key";
    preferences().openAIReasoningEffort = "medium";
    preferences().models = [{ provider: AIProviders.OPEN_AI, name: "gpt-6.1-sol" }];
    preferences().selectedModel = "gpt-6.1-sol";

    const getNamespaces = tool(async () => "integration-tests", {
      name: "getNamespaces",
      description: "List the namespaces",
      schema: z.object({ labelSelector: z.string().optional() }),
    });
    const model = useModelProvider().getModel().bindTools([getNamespaces]);

    const prompt = new HumanMessage("Which namespaces are there?");
    const call = await model.invoke([prompt]);
    expect(call.tool_calls).toMatchObject([{ id: "call_1", name: "getNamespaces", args: {} }]);
    const answer = await model.invoke([
      prompt,
      call,
      new ToolMessage({ tool_call_id: "call_1", content: "integration-tests" }),
    ]);
    expect(flattenContentText(answer.content)).toBe("integration-tests");

    const requests = vi.mocked(Main.Util.fetch).mock.calls.map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String(init?.body)),
    }));
    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.openai.com/v1/responses",
      "https://api.openai.com/v1/responses",
    ]);
    for (const { body } of requests) {
      expect(body).toMatchObject({
        model: "gpt-6.1-sol",
        store: false,
        include: ["reasoning.encrypted_content"],
        reasoning: { effort: "medium" },
        tools: [{ type: "function", name: "getNamespaces", strict: false }],
      });
      expect(body.temperature).toBeUndefined();
    }
    // The reasoning of the tool call goes back with its encrypted content, and
    // no item is referenced by an id that only a stored response would have.
    const replayed = requests[1]?.body.input as Record<string, unknown>[];
    expect(replayed).toContainEqual(
      expect.objectContaining({ type: "reasoning", encrypted_content: "encrypted-reasoning" }),
    );
    expect(replayed).toContainEqual(expect.objectContaining({ type: "function_call", call_id: "call_1" }));
    expect(replayed).toContainEqual({ type: "function_call_output", call_id: "call_1", output: "integration-tests" });
    expect(replayed.some((item) => item.type === "item_reference")).toBe(false);
  });
});
