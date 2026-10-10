import { describe, expect, it } from "vitest";
import { AIProviders, type CustomModel } from "./ai-models";
import { buildAgentReadinessInput, isAgentConfigured } from "./chat-readiness";

const openAiModels: CustomModel[] = [
  { provider: AIProviders.OPEN_AI, name: "gpt-5.5" },
  { provider: AIProviders.OPEN_AI, name: "gpt-5.4" },
];

describe("isAgentConfigured", () => {
  it("is false when the model list is empty", () => {
    expect(isAgentConfigured({ models: [] })).toBe(false);
  });

  // Keys live in main now (pi's auth.json), which refuses a prompt without them.
  it("is true with a model even when no key is visible to the renderer", () => {
    expect(isAgentConfigured(buildAgentReadinessInput({ models: openAiModels }))).toBe(true);
  });
});
