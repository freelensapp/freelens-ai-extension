import { describe, expect, it, vi } from "vitest";
import { buildOpenAIChatFields } from "./openai-fields";

const fetch = vi.fn<typeof globalThis.fetch>();

const baseOptions = {
  apiKey: "sk-test",
  baseUrl: "https://gateway.example.com/v1",
  fetch,
};

describe("buildOpenAIChatFields", () => {
  it("sends the requests to the endpoint with the given fetch and key", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-4.1" });
    expect(fields.model).toBe("gpt-4.1");
    expect(fields.apiKey).toBe("sk-test");
    expect(fields.configuration?.baseURL).toBe("https://gateway.example.com/v1");
    expect(fields.configuration?.fetch).toBe(fetch);
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

  it.each(["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"])(
    "sets reasoning effort and omits temperature for %s",
    (modelName) => {
      const fields = buildOpenAIChatFields({ ...baseOptions, modelName, reasoningEffort: "medium" });
      expect(fields.reasoning?.effort).toBe("medium");
      expect(fields.temperature).toBeUndefined();
    },
  );

  it.each(["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "gpt-5.6-cyber"])(
    "sends %s through the Responses API, stateless and with non-strict tools",
    (modelName) => {
      const fields = buildOpenAIChatFields({ ...baseOptions, modelName });
      expect(fields.useResponsesApi).toBe(true);
      expect(fields.zdrEnabled).toBe(true);
      expect(fields.supportsStrictToolCalling).toBe(false);
      expect(fields.modelKwargs).toEqual({ include: ["reasoning.encrypted_content"] });
    },
  );

  it.each(["gpt-5.5", "gpt-5.4-mini", "gpt-4.1", "deepseek-v4-pro"])(
    "leaves the API of %s to the client",
    (modelName) => {
      const fields = buildOpenAIChatFields({ ...baseOptions, modelName });
      expect(fields.useResponsesApi).toBeUndefined();
      expect(fields.zdrEnabled).toBeUndefined();
      expect(fields.supportsStrictToolCalling).toBeUndefined();
      expect(fields.modelKwargs).toBeUndefined();
    },
  );

  it("disables thinking via modelKwargs when requested", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "deepseek-v4-pro", disableThinking: true });
    expect(fields.modelKwargs).toMatchObject({ thinking: { type: "disabled" } });
  });

  it("omits the thinking modelKwargs when not requested", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "deepseek-v4-pro" });
    expect(fields.modelKwargs).toBeUndefined();
  });
});
