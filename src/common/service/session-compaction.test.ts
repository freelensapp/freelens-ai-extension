import { describe, expect, it } from "vitest";
import {
  buildSummaryPrompt,
  COMPACTION_SUMMARY_INSTRUCTION,
  COMPACTION_THRESHOLD,
  DEFAULT_MAX_INPUT_TOKENS,
  estimateNextPromptTokens,
  renderConversationForSummary,
  resolveMaxInputTokens,
  shouldCompactSession,
  toSummarizableMessages,
} from "./session-compaction";

describe("resolveMaxInputTokens", () => {
  it("uses the model's advertised max input tokens", () => {
    expect(resolveMaxInputTokens({ maxInputTokens: 200_000 })).toBe(200_000);
  });

  it("falls back to 128000 for an unknown model", () => {
    expect(resolveMaxInputTokens(undefined)).toBe(DEFAULT_MAX_INPUT_TOKENS);
    expect(DEFAULT_MAX_INPUT_TOKENS).toBe(128_000);
  });

  it("falls back when the limit is missing, zero, or not finite", () => {
    expect(resolveMaxInputTokens({ maxInputTokens: undefined })).toBe(DEFAULT_MAX_INPUT_TOKENS);
    expect(resolveMaxInputTokens({ maxInputTokens: 0 })).toBe(DEFAULT_MAX_INPUT_TOKENS);
    expect(resolveMaxInputTokens({ maxInputTokens: Number.POSITIVE_INFINITY })).toBe(DEFAULT_MAX_INPUT_TOKENS);
  });

  it("honours a custom fallback", () => {
    expect(resolveMaxInputTokens(undefined, 64_000)).toBe(64_000);
  });
});

describe("estimateNextPromptTokens", () => {
  it("adds the carried-over context to the next message estimate", () => {
    expect(estimateNextPromptTokens(1000, 250)).toBe(1250);
  });

  it("clamps negative inputs to zero", () => {
    expect(estimateNextPromptTokens(-5, -10)).toBe(0);
    expect(estimateNextPromptTokens(-5, 30)).toBe(30);
  });
});

describe("shouldCompactSession", () => {
  const max = 100_000;

  it("compacts once the estimate reaches the threshold", () => {
    expect(shouldCompactSession(max * COMPACTION_THRESHOLD, max)).toBe(true);
    expect(shouldCompactSession(max, max)).toBe(true);
  });

  it("does not compact below the threshold", () => {
    expect(shouldCompactSession(max * COMPACTION_THRESHOLD - 1, max)).toBe(false);
  });

  it("never compacts a fresh session with no prior response", () => {
    expect(shouldCompactSession(0, max)).toBe(false);
  });

  it("never compacts when the max is unknown (non-positive)", () => {
    expect(shouldCompactSession(95_000, 0)).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(shouldCompactSession(50_000, 100_000, 0.5)).toBe(true);
    expect(shouldCompactSession(49_999, 100_000, 0.5)).toBe(false);
  });
});

describe("renderConversationForSummary", () => {
  it("joins role-tagged turns and drops empty ones", () => {
    const rendered = renderConversationForSummary([
      { role: "user", content: "list pods" },
      { role: "assistant", content: "   " },
      { role: "assistant", content: "3 pods running" },
    ]);
    expect(rendered).toBe("user: list pods\n\nassistant: 3 pods running");
  });

  it("returns an empty string when there is nothing to summarize", () => {
    expect(renderConversationForSummary([])).toBe("");
  });
});

describe("buildSummaryPrompt", () => {
  it("prepends the instruction and wraps the conversation", () => {
    const prompt = buildSummaryPrompt([{ role: "user", content: "scale web to 3" }]);
    expect(prompt.startsWith(COMPACTION_SUMMARY_INSTRUCTION)).toBe(true);
    expect(prompt).toContain("<conversation>\nuser: scale web to 3\n</conversation>");
  });
});

describe("toSummarizableMessages", () => {
  it("maps the message type and flattens string content", () => {
    const result = toSummarizableMessages([
      { getType: () => "human", content: "list pods" },
      { getType: () => "ai", content: "3 pods running" },
    ]);
    expect(result).toEqual([
      { role: "human", content: "list pods" },
      { role: "ai", content: "3 pods running" },
    ]);
  });

  it("flattens array content blocks to their text", () => {
    const result = toSummarizableMessages([
      {
        getType: () => "human",
        content: [
          { type: "text", text: "hello" },
          { type: "text", text: " world" },
        ],
      },
    ]);
    expect(result).toEqual([{ role: "human", content: "hello world" }]);
  });

  it("defaults the role to 'message' when the type is unavailable", () => {
    const result = toSummarizableMessages([{ content: "no type" }]);
    expect(result).toEqual([{ role: "message", content: "no type" }]);
  });
});
