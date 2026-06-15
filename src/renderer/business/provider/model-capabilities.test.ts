import { describe, expect, it } from "vitest";
import { isReasoningModel, supportsTemperature } from "./model-capabilities";

describe("isReasoningModel", () => {
  it.each([
    "o1",
    "o3-mini",
    "O1-preview",
    "gpt-5",
    "gpt-5.4",
    "gpt-5.5",
    "gpt-5.4-mini",
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

describe("supportsTemperature", () => {
  it("is the inverse of isReasoningModel", () => {
    for (const name of ["gpt-5.5", "o1", "gpt-4.1", "gpt-4o"]) {
      expect(supportsTemperature(name)).toBe(!isReasoningModel(name));
    }
  });
});
