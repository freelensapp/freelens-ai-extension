// Headers shared by every request routed through the local AI proxy (see
// `src/main/ai-proxy-server.ts`). The Strands model builder lives in
// `strands-openai-model.ts`; the pricing fetcher reuses the same headers.

// Header read by the local AI proxy to decide which upstream to forward to,
// letting the user configure a custom base URL without changing the proxy code.
export const UPSTREAM_BASE_URL_HEADER = "x-upstream-base-url";

// Header carrying the per-launch shared secret the proxy requires on every
// request.
export const PROXY_TOKEN_HEADER = "x-ai-proxy-token";

// Header that tells the proxy to fetch a public resource without attaching the
// managed API key (see model-pricing-provider.ts).
export const PROXY_NO_AUTH_HEADER = "x-ai-proxy-no-auth";
