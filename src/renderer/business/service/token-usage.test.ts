import { describe, expect, it } from "vitest";
import { addTokenUsage, emptyTokenUsage, formatTokenUsage, isEmptyTokenUsage } from "./token-usage";

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

describe("isEmptyTokenUsage", () => {
  it("is true only when every field is zero", () => {
    expect(isEmptyTokenUsage(emptyTokenUsage())).toBe(true);
    expect(isEmptyTokenUsage({ input: 0, cached: 0, output: 1 })).toBe(false);
    expect(isEmptyTokenUsage({ input: 1, cached: 0, output: 0 })).toBe(false);
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
