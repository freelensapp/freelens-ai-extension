import { describe, expect, it } from "vitest";
import {
  addTokenUsage,
  emptyTokenUsage,
  formatTokenUsage,
  isEmptyTokenUsage,
  tokenUsageFromModelUsage,
} from "./token-usage";

describe("tokenUsageFromModelUsage", () => {
  it("returns null for missing or non-object usage", () => {
    expect(tokenUsageFromModelUsage(undefined)).toBeNull();
    expect(tokenUsageFromModelUsage(null)).toBeNull();
  });

  it("returns null when every count is zero or absent", () => {
    expect(tokenUsageFromModelUsage({})).toBeNull();
    expect(tokenUsageFromModelUsage({ inputTokens: 0, outputTokens: 0 })).toBeNull();
  });

  it("reads input, output, and cache read tokens", () => {
    expect(
      tokenUsageFromModelUsage({
        inputTokens: 120,
        outputTokens: 45,
        inputTokenDetails: { cacheReadTokens: 80, cacheWriteTokens: undefined },
      }),
    ).toEqual({ input: 120, cached: 80, output: 45 });
  });

  it("reads the cache write tokens the provider maps", () => {
    expect(
      tokenUsageFromModelUsage({
        inputTokens: 120,
        outputTokens: 45,
        inputTokenDetails: { cacheReadTokens: 0, cacheWriteTokens: 100 },
      }),
    ).toEqual({ input: 120, cached: 0, output: 45, cacheWrite: 100 });
  });

  it("reads the cache write tokens of LiteLLM from the raw usage", () => {
    expect(
      tokenUsageFromModelUsage({ inputTokens: 10, outputTokens: 5, raw: { cache_creation_input_tokens: 7 } }),
    ).toEqual({ input: 10, cached: 0, output: 5, cacheWrite: 7 });
    expect(
      tokenUsageFromModelUsage({
        inputTokens: 10,
        outputTokens: 5,
        raw: { prompt_tokens_details: { cache_creation_tokens: 3 } },
      }),
    ).toEqual({ input: 10, cached: 0, output: 5, cacheWrite: 3 });
  });

  it("ignores non-finite counts", () => {
    expect(tokenUsageFromModelUsage({ inputTokens: Number.NaN, outputTokens: 7 })).toEqual({
      input: 0,
      cached: 0,
      output: 7,
    });
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

  it("keeps the cache write count once one of them has it", () => {
    expect(
      addTokenUsage({ input: 1, cached: 0, output: 1 }, { input: 1, cached: 0, output: 1, cacheWrite: 4 }),
    ).toEqual({ input: 2, cached: 0, output: 2, cacheWrite: 4 });
  });
});

describe("isEmptyTokenUsage", () => {
  it("is true only when every field is zero", () => {
    expect(isEmptyTokenUsage(emptyTokenUsage())).toBe(true);
    expect(isEmptyTokenUsage({ input: 0, cached: 0, output: 1 })).toBe(false);
    expect(isEmptyTokenUsage({ input: 1, cached: 0, output: 0 })).toBe(false);
    expect(isEmptyTokenUsage({ input: 0, cached: 0, output: 0, cacheWrite: 1 })).toBe(false);
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
