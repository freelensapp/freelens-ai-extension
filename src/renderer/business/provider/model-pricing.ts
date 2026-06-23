// Pure helpers for the per-session cost estimate shown next to the token
// counter. Kept free of host/MobX/fetch dependencies so the parsing and cost
// math can be unit-tested in isolation (see model-pricing.test.ts). The impure
// fetching (through the local AI proxy) lives in model-pricing-provider.ts.

import type { TokenUsage } from "../service/token-usage";

// Per-token costs (in USD) and context limits for a single model. All costs are
// per single token, matching the LiteLLM data shape. `cachedInputCostPerToken`
// is the discounted price charged for prompt-cache reads; when a model does not
// advertise one, callers fall back to the full input price.
export interface ModelPricing {
  inputCostPerToken: number;
  cachedInputCostPerToken?: number;
  outputCostPerToken: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

// Map of model name => pricing. Only models we found prices for are present.
export type ModelPricingMap = Record<string, ModelPricing>;

const toCost = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const toLimit = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

// The fields we read from a single LiteLLM model entry (both the
// `model_prices_and_context_window.json` values and a `/model/info` entry's
// `model_info` use the same field names). Everything else is ignored.
interface LiteLLMModelInfoLike {
  input_cost_per_token?: unknown;
  output_cost_per_token?: unknown;
  cache_read_input_token_cost?: unknown;
  max_input_tokens?: unknown;
  max_output_tokens?: unknown;
}

/**
 * Turn one raw LiteLLM model-info record into a {@link ModelPricing}. Returns
 * `null` when neither an input nor an output price is present, so callers can
 * skip non-chat or price-less entries (e.g. the file's `sample_spec` key).
 */
export const parseModelInfo = (info: unknown): ModelPricing | null => {
  if (!info || typeof info !== "object") {
    return null;
  }

  const record = info as LiteLLMModelInfoLike;
  const inputCostPerToken = toCost(record.input_cost_per_token);
  const outputCostPerToken = toCost(record.output_cost_per_token);

  if (inputCostPerToken === undefined && outputCostPerToken === undefined) {
    return null;
  }

  return {
    inputCostPerToken: inputCostPerToken ?? 0,
    outputCostPerToken: outputCostPerToken ?? 0,
    cachedInputCostPerToken: toCost(record.cache_read_input_token_cost),
    maxInputTokens: toLimit(record.max_input_tokens),
    maxOutputTokens: toLimit(record.max_output_tokens),
  };
};

/**
 * Parse the LiteLLM `model_prices_and_context_window.json` document (an object
 * keyed by model name) into a {@link ModelPricingMap}. The synthetic
 * `sample_spec` entry and any price-less entries are skipped.
 */
export const parsePriceMap = (json: unknown): ModelPricingMap => {
  if (!json || typeof json !== "object") {
    return {};
  }

  const map: ModelPricingMap = {};
  for (const [name, info] of Object.entries(json as Record<string, unknown>)) {
    if (name === "sample_spec") {
      continue;
    }
    const pricing = parseModelInfo(info);
    if (pricing) {
      map[name] = pricing;
    }
  }
  return map;
};

// The `/model/info` response shape returned by a LiteLLM proxy: a `data` array
// of `{ model_name, model_info }` entries.
interface ModelInfoResponseLike {
  data?: Array<{ model_name?: unknown; model_info?: unknown }>;
}

/**
 * Parse a LiteLLM `/model/info` response into a {@link ModelPricingMap}, keyed
 * by each entry's `model_name`.
 */
export const parseModelInfoResponse = (json: unknown): ModelPricingMap => {
  if (!json || typeof json !== "object") {
    return {};
  }

  const { data } = json as ModelInfoResponseLike;
  if (!Array.isArray(data)) {
    return {};
  }

  const map: ModelPricingMap = {};
  for (const entry of data) {
    const name = entry?.model_name;
    if (typeof name !== "string" || !name) {
      continue;
    }
    const pricing = parseModelInfo(entry?.model_info);
    if (pricing) {
      map[name] = pricing;
    }
  }
  return map;
};

/**
 * Build the pricing map for exactly the configured model names, preferring the
 * primary source (the endpoint's `/model/info`) over the fallback (the public
 * LiteLLM price list) for each name. Only names we found a price for end up in
 * the result, so an absent model simply has no cost shown.
 */
export const buildModelPricingMap = (
  modelNames: string[],
  primary: ModelPricingMap,
  fallback: ModelPricingMap,
): ModelPricingMap => {
  const map: ModelPricingMap = {};
  for (const name of modelNames) {
    const pricing = primary[name] ?? fallback[name];
    if (pricing) {
      map[name] = pricing;
    }
  }
  return map;
};

/**
 * Compute the session cost (USD) for a model's pricing and the running token
 * totals. Cached input tokens are billed at the discounted cache-read price and
 * are excluded from the full-priced input tokens, matching:
 *   input_price * (input - cached) + cached_input_price * cached + output_price * output
 * When the model advertises no cache-read price, cached tokens fall back to the
 * full input price.
 */
export const computeSessionCost = (usage: TokenUsage, pricing: ModelPricing): number => {
  const cached = Math.min(usage.cached, usage.input);
  const uncachedInput = Math.max(0, usage.input - cached);
  const cachedPrice = pricing.cachedInputCostPerToken ?? pricing.inputCostPerToken;

  return uncachedInput * pricing.inputCostPerToken + cached * cachedPrice + usage.output * pricing.outputCostPerToken;
};

/**
 * Format a USD cost as `$x.xx`. Sub-cent amounts use more decimals so a small
 * but non-zero cost is not rendered as a misleading `$0.00`.
 */
export const formatCost = (cost: number): string => {
  if (cost > 0 && cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
};
