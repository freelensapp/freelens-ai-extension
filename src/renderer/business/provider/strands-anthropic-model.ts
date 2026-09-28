// Pure builder for the options passed to the Strands `AnthropicModel` (Messages
// API). The Anthropic counterpart of `strands-openai-model.ts`: every request
// targets the local AI proxy under the "/anthropic" prefix, which injects the
// real API key (as `x-api-key`) in the main process and forwards to the
// Anthropic-compatible upstream advertised via UPSTREAM_BASE_URL_HEADER.

import { AnthropicModel } from "@strands-agents/sdk/models/anthropic";
import { PROVIDER_ID_HEADER, PROXY_TOKEN_HEADER, UPSTREAM_BASE_URL_HEADER } from "./openai-fields";

import type { AnthropicModelOptions } from "@strands-agents/sdk/models/anthropic";

// The Messages API requires `max_tokens`. The Strands default (64000) exceeds
// the output limit of many Claude models and compatible endpoints, which then
// reject the request; this fits every current model and a chat answer.
export const ANTHROPIC_MAX_TOKENS = 8192;

export interface StrandsAnthropicModelOptions {
  // Model id sent to the Anthropic API (e.g. "claude-sonnet-4-5").
  modelName: string;
  // API key used for the request.
  apiKey: string;
  // Full upstream base URL advertised to the proxy (e.g. https://api.anthropic.com).
  upstreamBaseUrl: string;
  // Local proxy origin (e.g. http://127.0.0.1:<port>); the "/anthropic" prefix is appended.
  proxyBaseUrl: string;
  // Per-launch shared secret sent to the proxy so it accepts the request.
  proxyToken?: string | null;
  // Id of the configured provider; the proxy injects that provider's API key.
  providerId?: string;
  // When true, request the upstream to disable its "thinking" mode; forwarded
  // verbatim via `params` so it reaches the request body.
  disableThinking?: boolean;
}

export const buildStrandsAnthropicModelOptions = ({
  modelName,
  apiKey,
  upstreamBaseUrl,
  proxyBaseUrl,
  proxyToken,
  providerId,
  disableThinking,
}: StrandsAnthropicModelOptions): AnthropicModelOptions => {
  const options: AnthropicModelOptions = {
    modelId: modelName,
    apiKey,
    maxTokens: ANTHROPIC_MAX_TOKENS,
    clientConfig: {
      // The proxy strips the "/anthropic" prefix and forwards to the upstream
      // advertised via UPSTREAM_BASE_URL_HEADER.
      baseURL: `${proxyBaseUrl}/anthropic`,
      // The agent runs in the Electron renderer, which the Anthropic SDK detects
      // as a browser. The key sent from here is a placeholder: the local proxy
      // injects the real one in the main process.
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        [UPSTREAM_BASE_URL_HEADER]: upstreamBaseUrl,
        ...(proxyToken ? { [PROXY_TOKEN_HEADER]: proxyToken } : {}),
        ...(providerId ? { [PROVIDER_ID_HEADER]: providerId } : {}),
      },
    },
  };

  if (disableThinking) {
    options.params = { thinking: { type: "disabled" } };
  }

  return options;
};

// Instantiates the Strands `AnthropicModel` from the resolved options. Reasoning
// ("thinking") deltas reach the stream as regular Strands reasoning events, so
// no tap is needed as for the OpenAI chat adapter.
export const createStrandsAnthropicModel = (options: StrandsAnthropicModelOptions): AnthropicModel =>
  new AnthropicModel(buildStrandsAnthropicModelOptions(options));
