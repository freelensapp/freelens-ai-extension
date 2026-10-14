import { describe, expect, it } from "vitest";
import { parseModelIds, validateCustomProvider } from "./custom-provider";

const input = {
  name: "My LiteLLM",
  baseUrl: "http://localhost:4000/v1/",
  apiKey: " sk-test ",
  modelIds: ["qwen3", " llama3 ", "qwen3"],
  reasoning: true,
};

describe("validateCustomProvider", () => {
  it("normalizes a valid endpoint", () => {
    expect(validateCustomProvider(input)).toEqual({
      ok: true,
      provider: {
        id: "my-litellm",
        name: "My LiteLLM",
        baseUrl: "http://localhost:4000/v1",
        apiKey: "sk-test",
        modelIds: ["qwen3", "llama3"],
        reasoning: true,
      },
    });
  });

  it("requires a name", () => {
    expect(validateCustomProvider({ ...input, name: "  " })).toEqual({
      ok: false,
      error: "Enter a name for the endpoint.",
    });
  });

  it("refuses a name whose id is already a provider", () => {
    const result = validateCustomProvider({ ...input, name: "OpenAI" }, new Set(["openai"]));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('"openai" already exists') });
  });

  it("requires a full http or https base URL", () => {
    expect(validateCustomProvider({ ...input, baseUrl: "localhost:4000" })).toMatchObject({ ok: false });
    expect(validateCustomProvider({ ...input, baseUrl: "not a url" })).toMatchObject({ ok: false });
    expect(validateCustomProvider({ ...input, baseUrl: "ftp://example.com/v1" })).toEqual({
      ok: false,
      error: "The base URL must start with http:// or https://.",
    });
  });

  it("requires at least one model id", () => {
    expect(validateCustomProvider({ ...input, modelIds: [" ", ""] })).toEqual({
      ok: false,
      error: "Enter at least one model id.",
    });
  });

  it("allows an endpoint without a key", () => {
    const result = validateCustomProvider({ ...input, apiKey: undefined });
    expect(result).toMatchObject({ ok: true, provider: { apiKey: "" } });
  });
});

describe("parseModelIds", () => {
  it("splits on commas and new lines", () => {
    expect(parseModelIds("qwen3, llama3\n\nmistral,qwen3")).toEqual(["qwen3", "llama3", "mistral"]);
  });
});
