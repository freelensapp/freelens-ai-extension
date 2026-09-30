import { describe, expect, it } from "vitest";
import { buildOpenAIChatFields, PROXY_TOKEN_HEADER, UPSTREAM_BASE_URL_HEADER } from "./openai-fields";

const baseOptions = {
  apiKey: "sk-test",
  upstreamBaseUrl: "https://api.openai.com/v1",
  proxyBaseUrl: "http://127.0.0.1:1234",
};

describe("buildOpenAIChatFields", () => {
  it("routes through the proxy and advertises the upstream via header", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-4.1" });
    expect(fields.model).toBe("gpt-4.1");
    expect(fields.apiKey).toBe("sk-test");
    expect(fields.configuration?.baseURL).toBe("http://127.0.0.1:1234/openai");
    expect(fields.configuration?.defaultHeaders).toMatchObject({
      [UPSTREAM_BASE_URL_HEADER]: "https://api.openai.com/v1",
    });
  });

  it("sends the proxy token header when a token is provided", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-4.1", proxyToken: "secret-token" });
    expect(fields.configuration?.defaultHeaders).toMatchObject({
      [PROXY_TOKEN_HEADER]: "secret-token",
    });
  });

  it("omits the proxy token header when no token is provided", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-4.1" });
    expect(fields.configuration?.defaultHeaders).not.toHaveProperty(PROXY_TOKEN_HEADER);
  });

  it("sets temperature 0 and no reasoning effort for non-reasoning models", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-4.1", reasoningEffort: "high" });
    expect(fields.temperature).toBe(0);
    expect(fields.reasoning).toBeUndefined();
  });

  it.each(["gpt-5.5", "gpt-6-sol", "gpt-6.1-sol"])("sets effort and omits temperature for %s", (modelName) => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName, reasoningEffort: "high" });
    expect(fields.reasoning?.effort).toBe("high");
    expect(fields.temperature).toBeUndefined();
  });

  it.each(["gpt-5.5", "gpt-6-sol", "gpt-6.1-sol"])("keeps the provider's default effort for %s", (modelName) => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName, reasoningEffort: "" });
    expect(fields.reasoning).toBeUndefined();
    expect(fields.temperature).toBeUndefined();
  });

  it.each([
    "gpt-5.4-pro",
    "gpt-5.5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-6-astra",
    "gpt-6.1-sol",
  ])("uses stateless Responses and non-strict tools for %s", (modelName) => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName });
    expect(fields.useResponsesApi).toBe(true);
    expect(fields.supportsStrictToolCalling).toBe(false);
    expect(fields.modelKwargs).toEqual({ store: false });
  });

  it.each([
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3",
    "llama3.2",
    "deepseek-v4-pro",
  ])("preserves Chat Completions options for %s", (modelName) => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName });
    expect(fields.useResponsesApi).toBeUndefined();
    expect(fields.supportsStrictToolCalling).toBeUndefined();
    expect(fields.modelKwargs).toBeUndefined();
  });

  it.each(["low", "medium", "high"])("uses Responses for GPT-5.4 with effort %s", (reasoningEffort) => {
    for (const modelName of ["gpt-5.4", "gpt-5.4-mini"]) {
      const fields = buildOpenAIChatFields({ ...baseOptions, modelName, reasoningEffort });
      expect(fields.useResponsesApi).toBe(true);
      expect(fields.supportsStrictToolCalling).toBe(false);
      expect(fields.modelKwargs).toEqual({ store: false, reasoning: { effort: reasoningEffort } });
      expect(fields.temperature).toBeUndefined();
    }
  });

  it("disables thinking via modelKwargs when requested", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "deepseek-v4-pro", disableThinking: true });
    expect(fields.modelKwargs).toMatchObject({ thinking: { type: "disabled" } });
  });

  it("omits the thinking modelKwargs when not requested", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "deepseek-v4-pro" });
    expect(fields.modelKwargs).toBeUndefined();
  });
});
