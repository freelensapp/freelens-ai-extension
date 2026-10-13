import { describe, expect, it } from "vitest";
import { AIProviders, type CustomModel, DEFAULT_MODELS } from "./ai-models";
import {
  addModel,
  findProvider,
  hasModel,
  normalizeModelName,
  removeModelAt,
  resolveSelectedModel,
} from "./model-list";

const models = (): CustomModel[] => [
  { provider: AIProviders.OPEN_AI, name: "gpt-5.5" },
  { provider: AIProviders.OPEN_AI, name: "gpt-5.4" },
];

describe("normalizeModelName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeModelName("  gpt-5.5  ")).toBe("gpt-5.5");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeModelName("   ")).toBe("");
  });
});

describe("hasModel", () => {
  it("matches on provider + name", () => {
    expect(hasModel(models(), AIProviders.OPEN_AI, "gpt-5.5")).toBe(true);
    expect(hasModel(models(), AIProviders.OPEN_AI, "gpt-4.1")).toBe(false);
  });
});

describe("addModel", () => {
  it("appends a new model and trims the name", () => {
    const result = addModel(models(), AIProviders.OPEN_AI, "  gpt-4.1 ");
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({ provider: AIProviders.OPEN_AI, name: "gpt-4.1" });
  });

  it("does not mutate the input list", () => {
    const input = models();
    addModel(input, AIProviders.OPEN_AI, "gpt-4.1");
    expect(input).toHaveLength(2);
  });

  it("ignores empty / whitespace-only names", () => {
    const input = models();
    expect(addModel(input, AIProviders.OPEN_AI, "   ")).toBe(input);
  });

  it("ignores duplicates of the same provider + name", () => {
    const input = models();
    expect(addModel(input, AIProviders.OPEN_AI, "gpt-5.5")).toBe(input);
  });
});

describe("removeModelAt", () => {
  it("removes the entry at the given index without mutating the input", () => {
    const input = models();
    const result = removeModelAt(input, 0);
    expect(result).toEqual([{ provider: AIProviders.OPEN_AI, name: "gpt-5.4" }]);
    expect(input).toHaveLength(2);
  });
});

describe("findProvider", () => {
  it("returns the provider of the matching model", () => {
    expect(findProvider(models(), "gpt-5.4")).toBe(AIProviders.OPEN_AI);
  });

  it("returns undefined when no model matches", () => {
    expect(findProvider(models(), "missing")).toBeUndefined();
  });
});

describe("resolveSelectedModel", () => {
  it("keeps a selection that still exists", () => {
    expect(resolveSelectedModel(models(), "gpt-5.4")).toBe("gpt-5.4");
  });

  it("falls back to the first model when the selection is missing", () => {
    expect(resolveSelectedModel(models(), "removed-model")).toBe("gpt-5.5");
  });

  it("returns an empty string for an empty list", () => {
    expect(resolveSelectedModel([], "gpt-5.5")).toBe("");
  });

  it("resolves the seed list selection", () => {
    expect(resolveSelectedModel([...DEFAULT_MODELS], "")).toBe(DEFAULT_MODELS[0].name);
  });
});
