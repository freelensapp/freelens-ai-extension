import { describe, expect, it } from "vitest";
import {
  emitsDsmlToolCalls,
  isReasoningModel,
  requiresAutoToolChoice,
  requiresResponsesApi,
  supportsTemperature,
} from "./model-capabilities";

describe("isReasoningModel", () => {
  it.each([
    "o1",
    "o3-mini",
    "O1-preview",
    "gpt-5",
    "gpt-5.4",
    "gpt-5.5",
    "gpt-5.4-mini",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-6-astra",
    "gpt-6.1-sol",
  ])("treats %s as a reasoning model", (name) => {
    expect(isReasoningModel(name)).toBe(true);
  });

  it.each([
    "gpt-4.1",
    "gpt-4o",
    "gpt-3.5-turbo",
    "text-embedding-3-small",
    "",
  ])("treats %s as a non-reasoning model", (name) => {
    expect(isReasoningModel(name)).toBe(false);
  });
});

describe("requiresResponsesApi", () => {
  it.each([
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-6-astra",
    "gpt-6.1-sol",
    "openai/GPT-6.1-sol",
  ])("uses Responses for %s", (name) => {
    expect(requiresResponsesApi(name)).toBe(true);
  });

  it.each([
    "gpt-5",
    "gpt-5.3",
    "gpt-5.3-mini",
    "gpt-4o",
    "o3-mini",
    "deepseek-v4-pro",
    "qwen3-235b",
    "gpt-60",
    "gpt-50.4",
    "",
  ])("keeps Chat Completions for %s", (name) => {
    expect(requiresResponsesApi(name)).toBe(false);
  });
});

describe("requiresAutoToolChoice", () => {
  it.each([
    "deepseek-v4-pro",
    "deepseek-reasoner",
    "DeepSeek-V4",
    "qwen3-235b",
    "Qwen2.5-72B",
  ])("requires tool_choice auto for thinking model %s", (name) => {
    expect(requiresAutoToolChoice(name)).toBe(true);
  });

  it.each(["gpt-5.5", "gpt-5.4", "gpt-4o", "o3-mini", ""])("keeps forced tool_choice for %s", (name) => {
    expect(requiresAutoToolChoice(name)).toBe(false);
  });
});

describe("emitsDsmlToolCalls", () => {
  it.each([
    "deepseek-v4-pro",
    "deepseek-reasoner",
    "DeepSeek-V4",
  ])("flags DeepSeek model %s as DSML-emitting", (name) => {
    expect(emitsDsmlToolCalls(name)).toBe(true);
  });

  it.each(["gpt-5.5", "gpt-4o", "qwen3-235b", "o3-mini", ""])("does not flag %s", (name) => {
    expect(emitsDsmlToolCalls(name)).toBe(false);
  });
});

describe("supportsTemperature", () => {
  it("is the inverse of isReasoningModel", () => {
    for (const name of ["gpt-5.5", "o1", "gpt-4.1", "gpt-4o"]) {
      expect(supportsTemperature(name)).toBe(!isReasoningModel(name));
    }
  });
});
