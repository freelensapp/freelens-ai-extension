import { Main } from "@freelensapp/extensions";
import { generateText, isStepCount, tool } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AIProviders } from "../../common/provider/ai-models";
import { PreferencesStore } from "../../common/store";
import { resolveOpenAIKey, useModelProvider } from "./model-provider";

const preferences = () => PreferencesStore.getInstanceOrCreate<PreferencesStore>();

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

// A chat completion as an OpenAI-compatible endpoint answers it.
const completion = (content: string, model = "gpt-4.1") =>
  json({
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 0,
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  });

// A response of the Responses API with the given output items.
const responsesAnswer = (output: Record<string, unknown>[]) =>
  json({
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
  });

const requestsSent = () =>
  vi.mocked(Main.Util.fetch).mock.calls.map(([url, init]) => ({
    url: String(url),
    headers: new Headers(init?.headers as HeadersInit),
    body: JSON.parse(String(init?.body)),
  }));

const select = (name: string, baseUrl?: string) => {
  preferences().openAIKey = "preferences-key";
  if (baseUrl) {
    preferences().openAIBaseUrl = baseUrl;
  }
  preferences().models = [{ provider: AIProviders.OPEN_AI, name }];
  preferences().selectedModel = name;
};

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

  it("sends the requests of another base URL through the host's fetch, to Chat Completions, with the key", async () => {
    vi.mocked(Main.Util.fetch).mockImplementation(async () => completion("pong") as never);
    select("gpt-4.1", "http://litellm.local:4000/v1");

    const { text } = await generateText({ model: useModelProvider().getModel(), prompt: "ping" });

    expect(text).toBe("pong");
    const [request] = requestsSent();
    expect(requestsSent()).toHaveLength(1);
    expect(request?.url).toBe("http://litellm.local:4000/v1/chat/completions");
    expect(request?.headers.get("authorization")).toBe("Bearer preferences-key");
    expect(request?.body).toMatchObject({ model: "gpt-4.1", temperature: 0 });
  });

  it("sends the disable thinking flag of the preferences in the body of another base URL", async () => {
    vi.mocked(Main.Util.fetch).mockImplementation(async () => completion("pong", "deepseek-v4") as never);
    select("deepseek-v4", "http://litellm.local:4000/v1");
    preferences().disableThinking = true;

    await generateText({ model: useModelProvider().getModel(), prompt: "ping" });

    expect(requestsSent()[0]?.body).toMatchObject({ model: "deepseek-v4", thinking: { type: "disabled" } });
  });

  it("recovers the DSML tool calls a DeepSeek model leaks into its text", async () => {
    vi.mocked(Main.Util.fetch)
      .mockImplementationOnce(
        async () =>
          completion(
            'Listing them.<｜｜DSML｜｜invoke name="getNamespaces"></｜｜DSML｜｜invoke>',
            "deepseek-v4",
          ) as never,
      )
      .mockImplementationOnce(async () => completion("default, kube-system", "deepseek-v4") as never);
    select("deepseek-v4", "http://litellm.local:4000/v1");
    const execute = vi.fn(async () => ["default", "kube-system"]);

    const result = await generateText({
      model: useModelProvider().getModel(),
      prompt: "Which namespaces are there?",
      tools: { getNamespaces: tool({ inputSchema: z.object({}), execute }) },
      stopWhen: isStepCount(2),
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(result.steps[0]?.text).toBe("Listing them.");
    expect(result.steps[0]?.toolCalls).toMatchObject([{ toolName: "getNamespaces", input: {} }]);
    expect(result.text).toBe("default, kube-system");
    // The second request carries the recovered call as a structured one.
    const replayed = requestsSent()[1]?.body.messages as Record<string, unknown>[];
    expect(replayed).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        tool_calls: [expect.objectContaining({ function: { name: "getNamespaces", arguments: "{}" } })],
      }),
    );
  });

  it("sends a model of the OpenAI API to Chat Completions with its reasoning effort", async () => {
    vi.mocked(Main.Util.fetch).mockImplementation(async () => completion("pong", "gpt-5.5") as never);
    select("gpt-5.5");
    preferences().openAIReasoningEffort = "high";

    await generateText({ model: useModelProvider().getModel(), prompt: "ping" });

    const [request] = requestsSent();
    expect(request?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request?.body).toMatchObject({ model: "gpt-5.5", reasoning_effort: "high" });
    expect(request?.body.temperature).toBeUndefined();
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
    select("gpt-6.1-sol");
    preferences().openAIReasoningEffort = "medium";

    const result = await generateText({
      model: useModelProvider().getModel(),
      prompt: "Which namespaces are there?",
      tools: {
        getNamespaces: tool({
          description: "List the namespaces",
          inputSchema: z.object({ labelSelector: z.string().optional() }),
          execute: async () => "integration-tests",
        }),
      },
      stopWhen: isStepCount(2),
    });
    expect(result.text).toBe("integration-tests");

    const requests = requestsSent();
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
    expect(replayed).toContainEqual(
      expect.objectContaining({ type: "function_call_output", call_id: "call_1", output: "integration-tests" }),
    );
    expect(replayed.some((item) => item.type === "item_reference")).toBe(false);
  });
});
