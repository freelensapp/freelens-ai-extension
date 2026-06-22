import { describe, expect, it } from "vitest";
import { appendCustomAgentRules } from "./agent-rules";

const BASE = "You are an agent.";

describe("appendCustomAgentRules", () => {
  it("returns the base prompt unchanged when no rules are provided", () => {
    expect(appendCustomAgentRules(BASE, "")).toBe(BASE);
    expect(appendCustomAgentRules(BASE, "   \n  ")).toBe(BASE);
    expect(appendCustomAgentRules(BASE, null)).toBe(BASE);
    expect(appendCustomAgentRules(BASE, undefined)).toBe(BASE);
  });

  it("appends trimmed custom rules wrapped in a custom_rules block", () => {
    const result = appendCustomAgentRules(BASE, "  Always answer in French.  ");
    expect(result).toContain(BASE);
    expect(result).toContain("<custom_rules>");
    expect(result).toContain("Always answer in French.");
    expect(result).toContain("</custom_rules>");
    // The trimmed rule must not keep its surrounding whitespace.
    expect(result).not.toContain("  Always answer in French.  ");
  });

  it("preserves the order: base prompt first, then the custom rules", () => {
    const result = appendCustomAgentRules(BASE, "Be concise.");
    expect(result.indexOf(BASE)).toBeLessThan(result.indexOf("Be concise."));
  });
});
