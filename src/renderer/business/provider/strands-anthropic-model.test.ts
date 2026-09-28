import { describe, expect, it } from "vitest";
import { PROXY_TOKEN_HEADER, UPSTREAM_BASE_URL_HEADER } from "./openai-fields";
import { ANTHROPIC_MAX_TOKENS, buildStrandsAnthropicModelOptions } from "./strands-anthropic-model";

const baseOptions = {
  modelName: "claude-sonnet-4-5",
  apiKey: "placeholder",
  upstreamBaseUrl: "https://api.anthropic.com",
  proxyBaseUrl: "http://127.0.0.1:1234",
};

describe("buildStrandsAnthropicModelOptions", () => {
  it("routes through the proxy and advertises the upstream via header", () => {
    const options = buildStrandsAnthropicModelOptions(baseOptions);
    expect(options.modelId).toBe("claude-sonnet-4-5");
    expect(options.apiKey).toBe("placeholder");
    expect(options.clientConfig?.baseURL).toBe("http://127.0.0.1:1234/anthropic");
    expect(options.clientConfig?.defaultHeaders).toMatchObject({
      [UPSTREAM_BASE_URL_HEADER]: "https://api.anthropic.com",
    });
  });

  it("allows the Anthropic client in the Electron renderer", () => {
    expect(buildStrandsAnthropicModelOptions(baseOptions).clientConfig?.dangerouslyAllowBrowser).toBe(true);
  });

  it("sets an explicit max_tokens", () => {
    expect(buildStrandsAnthropicModelOptions(baseOptions).maxTokens).toBe(ANTHROPIC_MAX_TOKENS);
  });

  it("sends the proxy token header only when a token is provided", () => {
    expect(
      buildStrandsAnthropicModelOptions({ ...baseOptions, proxyToken: "secret" }).clientConfig?.defaultHeaders,
    ).toMatchObject({ [PROXY_TOKEN_HEADER]: "secret" });
    expect(buildStrandsAnthropicModelOptions(baseOptions).clientConfig?.defaultHeaders).not.toHaveProperty(
      PROXY_TOKEN_HEADER,
    );
  });

  it("forwards the disable-thinking flag through params", () => {
    expect(buildStrandsAnthropicModelOptions(baseOptions).params).toBeUndefined();
    expect(buildStrandsAnthropicModelOptions({ ...baseOptions, disableThinking: true }).params).toEqual({
      thinking: { type: "disabled" },
    });
  });

  it("does not force a temperature", () => {
    expect(buildStrandsAnthropicModelOptions(baseOptions).temperature).toBeUndefined();
  });
});
