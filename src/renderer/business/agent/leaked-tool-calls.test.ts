import { describe, expect, it } from "vitest";
import { containsLeakedToolCallMarkup } from "./leaked-tool-calls";

describe("containsLeakedToolCallMarkup", () => {
  it("detects leaked DSML tool_calls markup", () => {
    const content =
      'OK, I\'m getting Kustomization directly.<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="listKubernetesResources"> ' +
      '<｜｜DSML｜｜parameter name="kind" string="true">Kustomization</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls>';
    expect(containsLeakedToolCallMarkup(content)).toBe(true);
  });

  it("detects DeepSeek native tool-call tokens", () => {
    expect(containsLeakedToolCallMarkup("<｜tool▁calls▁begin｜>")).toBe(true);
  });

  it("detects leaked markup inside array content parts", () => {
    const content = [
      { type: "text", text: "Sure, let me look that up. " },
      { type: "text", text: '<｜｜DSML｜｜invoke name="getKubernetesResource">' },
    ];
    expect(containsLeakedToolCallMarkup(content)).toBe(true);
  });

  it("returns false for normal assistant text", () => {
    expect(containsLeakedToolCallMarkup("The pod uses the image nginx:1.27.")).toBe(false);
  });

  it("returns false for empty content", () => {
    expect(containsLeakedToolCallMarkup("")).toBe(false);
    expect(containsLeakedToolCallMarkup([])).toBe(false);
  });

  it("does not flag the literal word DSML in prose", () => {
    expect(containsLeakedToolCallMarkup("DSML stands for domain-specific markup language.")).toBe(false);
  });
});
