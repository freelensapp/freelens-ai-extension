// Fetches model pricing through the local AI proxy and builds the map consumed
// by the per-session cost estimate. The pure parsing/cost math lives in
// model-pricing.ts; this module owns only the (impure) network access.
//
// Two sources, in order of preference per model:
//   1. The endpoint's own `/model/info` (LiteLLM proxies expose prices there).
//      Fetched with a short timeout so a slow/absent endpoint never blocks the
//      UI.
//   2. The public LiteLLM `model_prices_and_context_window.json`, routed through
//      the proxy with the no-auth header so the user's API key is never sent to
//      GitHub.

import { DEFAULT_OPENAI_BASE_URL } from "./ai-models";
import { buildModelPricingMap, type ModelPricingMap, parseModelInfoResponse, parsePriceMap } from "./model-pricing";
import { PROXY_NO_AUTH_HEADER, PROXY_TOKEN_HEADER, UPSTREAM_BASE_URL_HEADER } from "./openai-fields";

// Short cap on the `/model/info` probe: a missing or slow endpoint must not hold
// up the cost display. The public price list has no explicit timeout beyond the
// platform default.
const MODEL_INFO_TIMEOUT_MS = 2000;

export interface FetchModelPricingOptions {
  modelNames: string[];
  openAIBaseUrl: string;
  proxyPort: number | null;
  proxyToken: string | null;
}

const proxyOrigin = (proxyPort: number): string => `http://127.0.0.1:${proxyPort}`;

// Resolve the JSON body of a proxied request, or null on any failure (timeout,
// non-2xx, unparseable body). The cost display is best-effort, so every error
// degrades to "no price" rather than surfacing to the user.
const fetchJson = async (url: string, headers: Record<string, string>, timeoutMs?: number): Promise<unknown> => {
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
  origin: string,
  openAIBaseUrl: string,
  proxyToken: string,
): Promise<ModelPricingMap> => {
  // Skip the probe for the stock OpenAI endpoint, which has no `/model/info`.
  if (!openAIBaseUrl || openAIBaseUrl === DEFAULT_OPENAI_BASE_URL) {
    return {};
  }

  const json = await fetchJson(
    `${origin}/openai/model/info`,
    {
      [UPSTREAM_BASE_URL_HEADER]: openAIBaseUrl,
      [PROXY_TOKEN_HEADER]: proxyToken,
    },
    MODEL_INFO_TIMEOUT_MS,
  );
  return parseModelInfoResponse(json);
};

// Fetch the public LiteLLM price list through the proxy without credentials.
const fetchPublicPricing = async (origin: string, proxyToken: string): Promise<ModelPricingMap> => {
  const json = await fetchJson(`${origin}/litellm/model_prices_and_context_window.json`, {
    [PROXY_TOKEN_HEADER]: proxyToken,
    [PROXY_NO_AUTH_HEADER]: "1",
  });
  return parsePriceMap(json);
};

/**
 * Build the pricing map for the configured models. Returns an empty map when the
 * proxy is not ready yet so callers can simply hide the cost until it is.
 */
export const fetchModelPricing = async ({
  modelNames,
  openAIBaseUrl,
  proxyPort,
  proxyToken,
}: FetchModelPricingOptions): Promise<ModelPricingMap> => {
  if (proxyPort === null || !proxyToken || modelNames.length === 0) {
    return {};
  }

  const origin = proxyOrigin(proxyPort);
  const primary = await fetchEndpointPricing(origin, openAIBaseUrl, proxyToken);

  // Only fetch the (large) public list when a configured model is still
  // unpriced after the endpoint probe.
  const needsFallback = modelNames.some((name) => !primary[name]);
  const fallback = needsFallback ? await fetchPublicPricing(origin, proxyToken) : {};

  return buildModelPricingMap(modelNames, primary, fallback);
};
