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

  it("sets reasoning effort and omits temperature for reasoning models", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-5.5", reasoningEffort: "high" });
    expect(fields.reasoning?.effort).toBe("high");
    expect(fields.temperature).toBeUndefined();
  });

  it("omits reasoning effort when it is not configured", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-5.5", reasoningEffort: "" });
    expect(fields.reasoning).toBeUndefined();
    expect(fields.temperature).toBeUndefined();
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
