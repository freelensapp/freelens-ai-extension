import { describe, expect, it } from "vitest";
import { DEFAULT_OPENAI_BASE_URL } from "../../common/provider/ai-models";
import { buildOpenAIModelOptions, COMPATIBLE_PROVIDER_NAME, isOpenAIBaseUrl } from "./openai-fields";

const GATEWAY = "https://gateway.example.com/v1";

describe("buildOpenAIModelOptions", () => {
  it("sends a model of another base URL to the OpenAI-compatible provider", () => {
    expect(buildOpenAIModelOptions({ modelName: "gpt-4.1", baseUrl: GATEWAY })).toEqual({
      api: "compatible",
      temperature: 0,
      providerOptions: { [COMPATIBLE_PROVIDER_NAME]: {} },
    });
  });

  it("sends a model of the OpenAI API to its Chat Completions", () => {
    expect(buildOpenAIModelOptions({ modelName: "gpt-4.1", baseUrl: `${DEFAULT_OPENAI_BASE_URL}/` }).api).toBe("chat");
  });

  it("sets temperature 0 and no reasoning effort for non-reasoning models", () => {
    const options = buildOpenAIModelOptions({ modelName: "gpt-4.1", baseUrl: GATEWAY, reasoningEffort: "high" });
    expect(options.temperature).toBe(0);
    expect(options.providerOptions[COMPATIBLE_PROVIDER_NAME]?.reasoningEffort).toBeUndefined();
  });

  it("sets reasoning effort and omits temperature for reasoning models", () => {
    const options = buildOpenAIModelOptions({
      modelName: "gpt-5.5",
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      reasoningEffort: "high",
    });
    expect(options).toEqual({ api: "chat", providerOptions: { openai: { reasoningEffort: "high" } } });
  });

  it("omits reasoning effort when it is not configured", () => {
    const options = buildOpenAIModelOptions({ modelName: "gpt-5.5", baseUrl: GATEWAY, reasoningEffort: "" });
    expect(options.providerOptions[COMPATIBLE_PROVIDER_NAME]).toEqual({});
    expect(options.temperature).toBeUndefined();
  });

  it.each(["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "gpt-5.6-cyber"])(
    "sends %s through the Responses API, at any base URL, without storing it",
    (modelName) => {
      for (const baseUrl of [DEFAULT_OPENAI_BASE_URL, GATEWAY]) {
        const options = buildOpenAIModelOptions({ modelName, baseUrl, reasoningEffort: "medium" });
        expect(options).toEqual({
          api: "responses",
          providerOptions: {
            openai: { store: false, include: ["reasoning.encrypted_content"], reasoningEffort: "medium" },
          },
        });
      }
    },
  );

  it.each(["gpt-5.5", "gpt-5.4-mini", "gpt-4.1", "deepseek-v4-pro"])("leaves %s on Chat Completions", (modelName) => {
    expect(buildOpenAIModelOptions({ modelName, baseUrl: GATEWAY }).api).toBe("compatible");
  });

  it("disables thinking in the request body of another base URL when requested", () => {
    const options = buildOpenAIModelOptions({ modelName: "deepseek-v4-pro", baseUrl: GATEWAY, disableThinking: true });
    expect(options.providerOptions[COMPATIBLE_PROVIDER_NAME]).toEqual({ thinking: { type: "disabled" } });
  });

  it("omits the thinking option when not requested, and for the OpenAI API", () => {
    expect(buildOpenAIModelOptions({ modelName: "deepseek-v4-pro", baseUrl: GATEWAY }).providerOptions).toEqual({
      [COMPATIBLE_PROVIDER_NAME]: {},
    });
    expect(
      buildOpenAIModelOptions({ modelName: "gpt-4.1", baseUrl: DEFAULT_OPENAI_BASE_URL, disableThinking: true })
        .providerOptions,
    ).toEqual({ openai: {} });
  });
});

describe("isOpenAIBaseUrl", () => {
  it("matches the OpenAI API with or without a trailing slash, and nothing else", () => {
    expect(isOpenAIBaseUrl(DEFAULT_OPENAI_BASE_URL)).toBe(true);
    expect(isOpenAIBaseUrl(` ${DEFAULT_OPENAI_BASE_URL}/ `)).toBe(true);
    expect(isOpenAIBaseUrl(GATEWAY)).toBe(false);
  });
});
