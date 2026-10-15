import { Main } from "@freelensapp/extensions";
import { HumanMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIProviders } from "../../common/provider/ai-models";
import { PreferencesStore } from "../../common/store";
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
});
