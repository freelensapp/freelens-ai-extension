// Fetches model pricing in main and builds the map consumed by the per-session
// cost estimate; the renderer reads it from the bridge. The pure parsing/cost
// math lives in model-pricing.ts; this module owns only the (impure) network
// access.
//
// Two sources, in order of preference per model:
//   1. The endpoint's own `/model/info` (LiteLLM proxies expose prices there).
//      Fetched with the API key and a short timeout so a slow/absent endpoint
//      never blocks the UI.
//   2. The public LiteLLM `model_prices_and_context_window.json`, fetched
//      without credentials so the user's API key is never sent to GitHub.

import { DEFAULT_OPENAI_BASE_URL } from "../../common/provider/ai-models";
import {
  buildModelPricingMap,
  type ModelPricingMap,
  parseModelInfoResponse,
  parsePriceMap,
} from "../../common/provider/model-pricing";

import type { Main } from "@freelensapp/extensions";

type HostFetch = typeof Main.Util.fetch;

// Short cap on the `/model/info` probe: a missing or slow endpoint must not hold
// up the cost display. The public price list has no explicit timeout beyond the
// platform default.
const MODEL_INFO_TIMEOUT_MS = 2000;

// Public LiteLLM model price and context-window list.
const PUBLIC_PRICE_LIST_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export interface FetchModelPricingOptions {
  modelNames: string[];
  openAIBaseUrl: string;
  apiKey: string | undefined;
  fetch: HostFetch;
}

// Resolve the JSON body of a request, or null on any failure (timeout, non-2xx,
// unparseable body). The cost display is best-effort, so every error degrades to
// "no price" rather than surfacing to the user.
const fetchJson = async (
  fetch: HostFetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs?: number,
): Promise<unknown> => {
  try {
    const response = await fetch(url, {
      headers,
      signal: typeof timeoutMs === "number" ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
};

// Query the endpoint's own `/model/info` (LiteLLM). Returns an empty map when
// the endpoint is the public OpenAI API (no such route), is slow, or errors.
const fetchEndpointPricing = async (
  fetch: HostFetch,
  openAIBaseUrl: string,
  apiKey: string | undefined,
): Promise<ModelPricingMap> => {
  // Skip the probe for the stock OpenAI endpoint, which has no `/model/info`.
  if (!openAIBaseUrl || openAIBaseUrl === DEFAULT_OPENAI_BASE_URL) {
    return {};
  }

  const json = await fetchJson(
    fetch,
    `${openAIBaseUrl.replace(/\/$/, "")}/model/info`,
    apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    MODEL_INFO_TIMEOUT_MS,
  );
  return parseModelInfoResponse(json);
};

/**
 * Build the pricing map for the configured models.
 */
export const fetchModelPricing = async ({
  modelNames,
  openAIBaseUrl,
  apiKey,
  fetch,
}: FetchModelPricingOptions): Promise<ModelPricingMap> => {
  if (modelNames.length === 0) {
    return {};
  }

  const primary = await fetchEndpointPricing(fetch, openAIBaseUrl, apiKey);

  // Only fetch the (large) public list when a configured model is still
  // unpriced after the endpoint probe.
  const needsFallback = modelNames.some((name) => !primary[name]);
  const fallback = needsFallback ? parsePriceMap(await fetchJson(fetch, PUBLIC_PRICE_LIST_URL, {})) : {};

  return buildModelPricingMap(modelNames, primary, fallback);
};
