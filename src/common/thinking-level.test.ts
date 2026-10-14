import { describe, expect, it } from "vitest";
import { loadThinkingLevel } from "./thinking-level";

describe("loadThinkingLevel", () => {
  it("keeps a saved level", () => {
    expect(loadThinkingLevel({ thinkingLevel: "xhigh", openAIReasoningEffort: "low", disableThinking: true })).toBe(
      "xhigh",
    );
  });

  it("falls back to medium for an unknown saved level", () => {
    expect(loadThinkingLevel({ thinkingLevel: "max" })).toBe("medium");
  });

  it("defaults to medium for a new install", () => {
    expect(loadThinkingLevel({})).toBe("medium");
  });

  it("imports the old reasoning effort once", () => {
    expect(loadThinkingLevel({ openAIReasoningEffort: "high" })).toBe("high");
  });

  it("imports the old Disable thinking mode switch as off", () => {
    expect(loadThinkingLevel({ openAIReasoningEffort: "high", disableThinking: true })).toBe("off");
  });

  it("ignores an old reasoning effort pi has no level for", () => {
    expect(loadThinkingLevel({ openAIReasoningEffort: "none" })).toBe("medium");
  });
});
