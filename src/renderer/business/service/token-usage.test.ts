import { describe, expect, it } from "vitest";
import {
  addTokenUsage,
  emptyTokenUsage,
  extractTokenUsage,
  extractTokenUsageFromLLMResult,
  formatTokenUsage,
} from "./token-usage";

describe("extractTokenUsage", () => {
  it("returns null for missing or non-object metadata", () => {
    expect(extractTokenUsage(undefined)).toBeNull();
    expect(extractTokenUsage(null)).toBeNull();
    expect(extractTokenUsage("nope")).toBeNull();
  });

  it("returns null when every count is zero or absent", () => {
    expect(extractTokenUsage({})).toBeNull();
    expect(extractTokenUsage({ input_tokens: 0, output_tokens: 0 })).toBeNull();
  });

  it("reads input, output, and cached read tokens", () => {
    expect(
      extractTokenUsage({
        input_tokens: 120,
        output_tokens: 45,
        input_token_details: { cache_read: 80 },
      }),
    ).toEqual({ input: 120, cached: 80, output: 45 });
  });

  it("defaults cached to zero when no cache_read is present", () => {
    expect(extractTokenUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({ input: 10, cached: 0, output: 5 });
  });

  it("ignores non-finite counts", () => {
    expect(extractTokenUsage({ input_tokens: Number.NaN, output_tokens: 7 })).toEqual({
      input: 0,
      cached: 0,
      output: 7,
    });
  });
});

describe("extractTokenUsageFromLLMResult", () => {
  it("returns null for missing or non-object results", () => {
    expect(extractTokenUsageFromLLMResult(undefined)).toBeNull();
    expect(extractTokenUsageFromLLMResult(null)).toBeNull();
    expect(extractTokenUsageFromLLMResult("nope")).toBeNull();
  });

  it("reads per-message usage_metadata from a single generation", () => {
    expect(
      extractTokenUsageFromLLMResult({
        generations: [
          [
            {
              message: {
                usage_metadata: { input_tokens: 100, output_tokens: 40, input_token_details: { cache_read: 30 } },
              },
            },
          ],
        ],
      }),
    ).toEqual({ input: 100, cached: 30, output: 40 });
  });

  it("sums usage_metadata across multiple generations", () => {
    expect(
      extractTokenUsageFromLLMResult({
        generations: [
          [{ message: { usage_metadata: { input_tokens: 100, output_tokens: 40 } } }],
          [
            {
              message: {
                usage_metadata: { input_tokens: 10, output_tokens: 5, input_token_details: { cache_read: 4 } },
              },
            },
          ],
        ],
      }),
    ).toEqual({ input: 110, cached: 4, output: 45 });
  });

  it("falls back to flat llmOutput.tokenUsage when no message carries usage_metadata", () => {
    expect(
      extractTokenUsageFromLLMResult({
        generations: [[{ message: {} }]],
        llmOutput: { tokenUsage: { promptTokens: 70, completionTokens: 12 } },
      }),
    ).toEqual({ input: 70, cached: 0, output: 12 });
  });

  it("returns null when neither source carries positive counts", () => {
    expect(extractTokenUsageFromLLMResult({ generations: [[{ message: {} }]] })).toBeNull();
    expect(
      extractTokenUsageFromLLMResult({ llmOutput: { tokenUsage: { promptTokens: 0, completionTokens: 0 } } }),
    ).toBeNull();
  });

  it("prefers usage_metadata over the flat fallback", () => {
    expect(
      extractTokenUsageFromLLMResult({
        generations: [[{ message: { usage_metadata: { input_tokens: 5, output_tokens: 6 } } }]],
        llmOutput: { tokenUsage: { promptTokens: 999, completionTokens: 999 } },
      }),
    ).toEqual({ input: 5, cached: 0, output: 6 });
  });
});

describe("addTokenUsage", () => {
  it("sums the running totals with a delta", () => {
    const total = addTokenUsage({ input: 100, cached: 20, output: 30 }, { input: 5, cached: 2, output: 8 });
    expect(total).toEqual({ input: 105, cached: 22, output: 38 });
  });

  it("starts from an empty total", () => {
    expect(addTokenUsage(emptyTokenUsage(), { input: 1, cached: 0, output: 2 })).toEqual({
      input: 1,
      cached: 0,
      output: 2,
    });
  });
});

describe("formatTokenUsage", () => {
  it("renders the compact counter string", () => {
    expect(formatTokenUsage({ input: 120, cached: 80, output: 45 })).toBe("in:120 (cached:80) + out:45");
  });

  it("groups large counts", () => {
    expect(formatTokenUsage({ input: 12345, cached: 6789, output: 1000 })).toBe("in:12,345 (cached:6,789) + out:1,000");
  });

  it("renders zeros for an empty session", () => {
    expect(formatTokenUsage(emptyTokenUsage())).toBe("in:0 (cached:0) + out:0");
  });
});
