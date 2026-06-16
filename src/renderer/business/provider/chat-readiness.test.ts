import { describe, expect, it } from "vitest";
import { AIProviders, type CustomModel } from "./ai-models";
import { isAgentConfigured } from "./chat-readiness";

const openAiModels: CustomModel[] = [
  { provider: AIProviders.OPEN_AI, name: "gpt-5.5" },
  { provider: AIProviders.OPEN_AI, name: "gpt-5.4" },
];

describe("isAgentConfigured", () => {
  it("is false when the model list is empty", () => {
    expect(isAgentConfigured({ models: [], selectedModel: "", openAIKey: "sk-test" })).toBe(false);
  });

  it("is false when an OpenAI model is selected but no key is set", () => {
    expect(isAgentConfigured({ models: openAiModels, selectedModel: "gpt-5.5", openAIKey: "" })).toBe(false);
  });

  it("treats a whitespace-only key as unset", () => {
    expect(isAgentConfigured({ models: openAiModels, selectedModel: "gpt-5.5", openAIKey: "   " })).toBe(false);
  });

  it("is true when an OpenAI model has a stored key", () => {
    expect(isAgentConfigured({ models: openAiModels, selectedModel: "gpt-5.5", openAIKey: "sk-test" })).toBe(true);
  });

  it("is true when only the environment key is set", () => {
    expect(
      isAgentConfigured({ models: openAiModels, selectedModel: "gpt-5.5", openAIKey: "", envOpenAIKey: "sk-env" }),
    ).toBe(true);
  });

  it("falls back to the first model's provider when the selection does not match", () => {
    expect(isAgentConfigured({ models: openAiModels, selectedModel: "unknown", openAIKey: "" })).toBe(false);
    expect(isAgentConfigured({ models: openAiModels, selectedModel: "unknown", openAIKey: "sk-test" })).toBe(true);
  });
});
