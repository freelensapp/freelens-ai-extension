import { describe, expect, it } from "vitest";
import { groupModels, resolvePickedModel } from "./model-picker";

import type { ProviderModelSummary } from "../../../common/provider-protocol";

const model = (provider: string, providerName: string, id: string, name = id): ProviderModelSummary => ({
  provider,
  providerName,
  id,
  name,
  contextWindow: 128_000,
  inputCost: 0,
  outputCost: 0,
  reasoning: false,
});

const models = [
  model("openai", "OpenAI", "gpt-5.5", "GPT-5.5"),
  model("anthropic", "Anthropic", "claude-opus-5-5", "Claude Opus 5.5"),
  model("openai", "OpenAI", "gpt-5.4-mini", "GPT-5.4 mini"),
];

describe("groupModels", () => {
  it("groups the models by provider name, keeping each provider's model order", () => {
    expect(groupModels(models)).toEqual([
      { label: "Anthropic", options: [{ value: "anthropic/claude-opus-5-5", label: "Claude Opus 5.5" }] },
      {
        label: "OpenAI",
        options: [
          { value: "openai/gpt-5.5", label: "GPT-5.5" },
          { value: "openai/gpt-5.4-mini", label: "GPT-5.4 mini" },
        ],
      },
    ]);
  });

  it("returns no groups when no provider is connected", () => {
    expect(groupModels([])).toEqual([]);
  });
});

describe("resolvePickedModel", () => {
  it("keeps the remembered model while its provider is connected", () => {
    expect(resolvePickedModel(models, "anthropic/claude-opus-5-5")).toBe("anthropic/claude-opus-5-5");
  });

  it("picks the first listed model when none was chosen yet", () => {
    expect(resolvePickedModel(models, "")).toBe("anthropic/claude-opus-5-5");
  });

  it("picks the first listed model when the remembered one is no longer available", () => {
    expect(resolvePickedModel(models, "xai/grok-5")).toBe("anthropic/claude-opus-5-5");
  });

  it("picks nothing when no provider is connected", () => {
    expect(resolvePickedModel([], "openai/gpt-5.5")).toBeUndefined();
  });
});
