import { describe, expect, it } from "vitest";
import { PROXY_TOKEN_HEADER, UPSTREAM_BASE_URL_HEADER } from "./openai-fields";
import { buildStrandsOpenAIModelOptions } from "./strands-openai-model";

const baseOptions = {
  apiKey: "sk-test",
  upstreamBaseUrl: "https://api.openai.com/v1",
  proxyBaseUrl: "http://127.0.0.1:1234",
};

// Narrow the chat-config view so tests can read chat-only fields directly.
const asChat = (options: ReturnType<typeof buildStrandsOpenAIModelOptions>) =>
  options as typeof options & { temperature?: number; params?: Record<string, unknown> };

describe("buildStrandsOpenAIModelOptions", () => {
  it("routes through the proxy and advertises the upstream via header", () => {
    const options = buildStrandsOpenAIModelOptions({ ...baseOptions, modelName: "gpt-4.1" });
    expect(options.api).toBe("chat");
    expect(options.modelId).toBe("gpt-4.1");
    expect(options.apiKey).toBe("sk-test");
    expect(options.clientConfig?.baseURL).toBe("http://127.0.0.1:1234/openai");
    expect(options.clientConfig?.defaultHeaders).toMatchObject({
      [UPSTREAM_BASE_URL_HEADER]: "https://api.openai.com/v1",
    });
  });

  it("sends the proxy token header when a token is provided", () => {
    const options = buildStrandsOpenAIModelOptions({
      ...baseOptions,
      modelName: "gpt-4.1",
      proxyToken: "secret-token",
    });
    expect(options.clientConfig?.defaultHeaders).toMatchObject({ [PROXY_TOKEN_HEADER]: "secret-token" });
  });

  it("omits the proxy token header when no token is provided", () => {
    const options = buildStrandsOpenAIModelOptions({ ...baseOptions, modelName: "gpt-4.1" });
    expect(options.clientConfig?.defaultHeaders).not.toHaveProperty(PROXY_TOKEN_HEADER);
  });

  it("sets temperature 0 and no reasoning effort for non-reasoning models", () => {
    const options = asChat(
      buildStrandsOpenAIModelOptions({ ...baseOptions, modelName: "gpt-4.1", reasoningEffort: "high" }),
    );
    expect(options.temperature).toBe(0);
    expect(options.params?.reasoning_effort).toBeUndefined();
  });

  it("sets reasoning effort and omits temperature for reasoning models", () => {
    const options = asChat(
      buildStrandsOpenAIModelOptions({ ...baseOptions, modelName: "gpt-5.5", reasoningEffort: "high" }),
    );
    expect(options.params?.reasoning_effort).toBe("high");
    expect(options.temperature).toBeUndefined();
  });

  it("omits reasoning effort when it is not configured", () => {
    const options = asChat(
      buildStrandsOpenAIModelOptions({ ...baseOptions, modelName: "gpt-5.5", reasoningEffort: "" }),
    );
    expect(options.params?.reasoning_effort).toBeUndefined();
    expect(options.temperature).toBeUndefined();
  });

  it("forwards disableThinking via params when requested", () => {
    const options = asChat(
      buildStrandsOpenAIModelOptions({ ...baseOptions, modelName: "deepseek-v4-pro", disableThinking: true }),
    );
    expect(options.params?.thinking).toEqual({ type: "disabled" });
  });

  it("omits params entirely when nothing extra is configured", () => {
    const options = asChat(buildStrandsOpenAIModelOptions({ ...baseOptions, modelName: "gpt-5.5" }));
    expect(options.params).toBeUndefined();
  });
});
