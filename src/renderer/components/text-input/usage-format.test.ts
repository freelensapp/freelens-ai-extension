import { describe, expect, it } from "vitest";
import { formatCost, formatTokenCounts, tokenCounts } from "./usage-format";

describe("tokenCounts", () => {
  it("counts cache reads and writes as input and shows the reads as cached", () => {
    expect(tokenCounts({ input: 100, output: 40, cacheRead: 300, cacheWrite: 20, total: 460 })).toEqual({
      input: 420,
      cached: 300,
      output: 40,
    });
  });

  it("is zero before main has sent any stats", () => {
    expect(tokenCounts(undefined)).toEqual({ input: 0, cached: 0, output: 0 });
  });
});

describe("formatTokenCounts", () => {
  it("renders the compact counter string", () => {
    expect(formatTokenCounts({ input: 120, cached: 80, output: 45 })).toBe("in:120 (cached:80) + out:45");
  });

  it("groups large counts", () => {
    expect(formatTokenCounts({ input: 12345, cached: 6789, output: 1000 })).toBe(
      "in:12,345 (cached:6,789) + out:1,000",
    );
  });
});

describe("formatCost", () => {
  it("uses two decimals for amounts of a cent or more", () => {
    expect(formatCost(1.2)).toBe("$1.20");
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(0)).toBe("$0.00");
  });

  it("uses four decimals for sub-cent non-zero amounts", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
  });
});
