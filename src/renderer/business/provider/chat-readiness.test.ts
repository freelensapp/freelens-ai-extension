import { describe, expect, it } from "vitest";
import { AIProviders, type CustomModel } from "./ai-models";
import { buildAgentReadinessInput, isAgentConfigured } from "./chat-readiness";

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

describe("isAgentConfigured with an Anthropic model", () => {
  const models: CustomModel[] = [
    { provider: AIProviders.OPEN_AI, name: "gpt-5.5" },
    { provider: AIProviders.ANTHROPIC, name: "claude-sonnet-4-5" },
  ];

  it("requires the Anthropic key, not the OpenAI one", () => {
    expect(isAgentConfigured({ models, selectedModel: "claude-sonnet-4-5", openAIKey: "sk-test" })).toBe(false);
    expect(
      isAgentConfigured({ models, selectedModel: "claude-sonnet-4-5", openAIKey: "", anthropicKey: "sk-ant" }),
    ).toBe(true);
  });

  it("accepts the Anthropic key from the environment", () => {
    expect(
      isAgentConfigured(
        buildAgentReadinessInput(
          { models, selectedModel: "claude-sonnet-4-5", openAIKey: "", anthropicKey: "" },
          { ANTHROPIC_API_KEY: "sk-env" },
        ),
      ),
    ).toBe(true);
  });

  it("does not let the Anthropic key configure an OpenAI model", () => {
    expect(isAgentConfigured({ models, selectedModel: "gpt-5.5", openAIKey: "", anthropicKey: "sk-ant" })).toBe(false);
  });
});

describe("buildAgentReadinessInput", () => {
  const prefsWithoutStoredKey = { models: openAiModels, selectedModel: "gpt-5.5", openAIKey: "" };

  it("picks up the key from the environment", () => {
    expect(isAgentConfigured(buildAgentReadinessInput(prefsWithoutStoredKey, { OPENAI_API_KEY: "sk-env" }))).toBe(true);
  });

  // Passing `undefined` would fall back to the real `process.env`, so an empty
  // object stands in for "no environment key set".
  it("is not configured without an environment key and without a stored key", () => {
    expect(isAgentConfigured(buildAgentReadinessInput(prefsWithoutStoredKey, {}))).toBe(false);
  });

  it("treats a whitespace-only environment key as unset", () => {
    expect(isAgentConfigured(buildAgentReadinessInput(prefsWithoutStoredKey, { OPENAI_API_KEY: "   " }))).toBe(false);
  });

  it("keeps working with the stored key alone", () => {
    expect(
      isAgentConfigured(
        buildAgentReadinessInput({ models: openAiModels, selectedModel: "gpt-5.5", openAIKey: "sk-test" }, {}),
      ),
    ).toBe(true);
  });
});
