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

  it("disables thinking via modelKwargs when requested", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "deepseek-v4-pro", disableThinking: true });
    expect(fields.modelKwargs).toMatchObject({ thinking: { type: "disabled" } });
  });

  it("omits the thinking modelKwargs when not requested", () => {
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "deepseek-v4-pro" });
    expect(fields.modelKwargs).toBeUndefined();
  });
});
