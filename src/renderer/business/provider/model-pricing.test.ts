import { describe, expect, it } from "vitest";
import {
  buildModelPricingMap,
  computeSessionCost,
  formatCost,
  parseModelInfo,
  parseModelInfoResponse,
  parsePriceMap,
} from "./model-pricing";

describe("parseModelInfo", () => {
  it("reads costs and limits from a LiteLLM model-info record", () => {
    expect(
      parseModelInfo({
        input_cost_per_token: 2.5e-6,
        output_cost_per_token: 1e-5,
        cache_read_input_token_cost: 1.25e-6,
        max_input_tokens: 128000,
        max_output_tokens: 16384,
      }),
    ).toEqual({
      inputCostPerToken: 2.5e-6,
      outputCostPerToken: 1e-5,
      cachedInputCostPerToken: 1.25e-6,
      maxInputTokens: 128000,
      maxOutputTokens: 16384,
    });
  });

  it("defaults a missing input or output price to 0 but keeps the other", () => {
    expect(parseModelInfo({ output_cost_per_token: 1e-5 })).toMatchObject({
      inputCostPerToken: 0,
      outputCostPerToken: 1e-5,
    });
  });

  it("returns null when neither input nor output price is present", () => {
    expect(parseModelInfo({ max_input_tokens: 1000 })).toBeNull();
    expect(parseModelInfo({})).toBeNull();
    expect(parseModelInfo(null)).toBeNull();
    expect(parseModelInfo("nope")).toBeNull();
  });

  it("ignores invalid (negative / non-finite) numbers", () => {
    expect(parseModelInfo({ input_cost_per_token: -1, output_cost_per_token: 1e-5, max_input_tokens: 0 })).toEqual({
      inputCostPerToken: 0,
      outputCostPerToken: 1e-5,
      cachedInputCostPerToken: undefined,
      maxInputTokens: undefined,
      maxOutputTokens: undefined,
    });
  });
});

describe("parsePriceMap", () => {
  it("keys entries by model name and skips sample_spec and price-less entries", () => {
    const map = parsePriceMap({
      sample_spec: { input_cost_per_token: 1, output_cost_per_token: 1 },
      "gpt-4o": { input_cost_per_token: 2.5e-6, output_cost_per_token: 1e-5 },
      "embed-only": { max_input_tokens: 1000 },
    });
    expect(Object.keys(map)).toEqual(["gpt-4o"]);
    expect(map["gpt-4o"].inputCostPerToken).toBe(2.5e-6);
  });

  it("returns an empty map for non-objects", () => {
    expect(parsePriceMap(null)).toEqual({});
    expect(parsePriceMap("nope")).toEqual({});
  });
});

describe("parseModelInfoResponse", () => {
  it("reads the LiteLLM /model/info data array keyed by model_name", () => {
    const map = parseModelInfoResponse({
      data: [
        { model_name: "gpt-4o", model_info: { input_cost_per_token: 2.5e-6, output_cost_per_token: 1e-5 } },
        { model_name: "no-price", model_info: { max_input_tokens: 1000 } },
        { model_info: { input_cost_per_token: 1, output_cost_per_token: 1 } },
      ],
    });
    expect(Object.keys(map)).toEqual(["gpt-4o"]);
  });

  it("returns an empty map when data is missing or not an array", () => {
    expect(parseModelInfoResponse({})).toEqual({});
    expect(parseModelInfoResponse({ data: "nope" })).toEqual({});
    expect(parseModelInfoResponse(null)).toEqual({});
  });
});

describe("buildModelPricingMap", () => {
  const primary = { "gpt-4o": { inputCostPerToken: 1, outputCostPerToken: 2 } };
  const fallback = {
    "gpt-4o": { inputCostPerToken: 9, outputCostPerToken: 9 },
    "gpt-3.5": { inputCostPerToken: 0.5, outputCostPerToken: 1 },
  };

  it("prefers the primary source over the fallback per model", () => {
    const map = buildModelPricingMap(["gpt-4o", "gpt-3.5"], primary, fallback);
    expect(map["gpt-4o"].inputCostPerToken).toBe(1);
    expect(map["gpt-3.5"].inputCostPerToken).toBe(0.5);
  });

  it("omits models with no price in either source", () => {
    const map = buildModelPricingMap(["gpt-4o", "unknown-model"], primary, fallback);
    expect(Object.keys(map)).toEqual(["gpt-4o"]);
  });
});

describe("computeSessionCost", () => {
  it("bills cached input at the discounted price and excludes it from full input", () => {
    const cost = computeSessionCost(
      { input: 1000, cached: 400, output: 200 },
      { inputCostPerToken: 1e-3, cachedInputCostPerToken: 1e-4, outputCostPerToken: 2e-3 },
    );
    // 600 * 1e-3 + 400 * 1e-4 + 200 * 2e-3 = 0.6 + 0.04 + 0.4 = 1.04
    expect(cost).toBeCloseTo(1.04, 10);
  });

  it("falls back to the full input price for cached tokens when no cache price is set", () => {
    const cost = computeSessionCost(
      { input: 1000, cached: 400, output: 0 },
      { inputCostPerToken: 1e-3, outputCostPerToken: 2e-3 },
    );
    // 600 * 1e-3 + 400 * 1e-3 = 1.0
    expect(cost).toBeCloseTo(1.0, 10);
  });

  it("clamps cached tokens to the input total", () => {
    const cost = computeSessionCost(
      { input: 100, cached: 500, output: 0 },
      { inputCostPerToken: 1e-3, cachedInputCostPerToken: 1e-4, outputCostPerToken: 0 },
    );
    // cached clamped to 100: 0 * 1e-3 + 100 * 1e-4 = 0.01
    expect(cost).toBeCloseTo(0.01, 10);
  });

  it("is zero for empty usage", () => {
    expect(
      computeSessionCost({ input: 0, cached: 0, output: 0 }, { inputCostPerToken: 1, outputCostPerToken: 1 }),
    ).toBe(0);
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
