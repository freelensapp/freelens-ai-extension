// Pure builder for the options passed to the Strands `OpenAIModel` (chat
// completions API). Separated from the store-aware provider so the
// option-building logic (proxy routing headers, reasoning-effort vs temperature
// heuristic) can be unit-tested without the MobX store or instantiating a real
// client.
//
// This is the Strands equivalent of `buildOpenAIChatFields`: it targets the
// same local AI proxy (baseURL + upstream/token headers) but shapes the config
// for `@strands-agents/sdk/models/openai` instead of `@langchain/openai`.

import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { isReasoningModel } from "./model-capabilities";
import { PROXY_TOKEN_HEADER, UPSTREAM_BASE_URL_HEADER } from "./openai-fields";

import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";

export interface StrandsOpenAIModelOptions {
  // Model id sent to the OpenAI API (e.g. "gpt-5.5").
  modelName: string;
  // API key used for the request.
  apiKey: string;
  // Full upstream base URL advertised to the proxy (e.g. https://api.openai.com/v1).
  upstreamBaseUrl: string;
  // Local proxy origin (e.g. http://127.0.0.1:<port>); the "/openai" prefix is appended.
  proxyBaseUrl: string;
  // Per-launch shared secret sent to the proxy so it accepts the request.
  proxyToken?: string | null;
  // Optional reasoning effort; applied only to reasoning-capable models.
  reasoningEffort?: string;
  // When true, request the upstream to disable its "thinking" mode. Mirrors the
  // LangChain path; forwarded verbatim via `params` so it reaches the request body.
  disableThinking?: boolean;
}

// Builds the discriminated `OpenAIModelOptions` for the chat completions API.
// Kept pure (no client instantiation) so it can be asserted directly in tests.
export const buildStrandsOpenAIModelOptions = ({
  modelName,
  apiKey,
  upstreamBaseUrl,
  proxyBaseUrl,
  proxyToken,
  reasoningEffort,
  disableThinking,
}: StrandsOpenAIModelOptions): OpenAIModelOptions => {
  // Provider-managed request fields that are not covered by dedicated config
  // properties are forwarded through `params` verbatim.
  const params: Record<string, unknown> = {};

  const options: OpenAIModelOptions = {
    api: "chat",
    modelId: modelName,
    apiKey,
    clientConfig: {
      // The proxy strips the "/openai" prefix and forwards to the upstream
      // advertised via UPSTREAM_BASE_URL_HEADER.
      baseURL: `${proxyBaseUrl}/openai`,
      defaultHeaders: {
        [UPSTREAM_BASE_URL_HEADER]: upstreamBaseUrl,
        ...(proxyToken ? { [PROXY_TOKEN_HEADER]: proxyToken } : {}),
      },
    },
  };

  // Reasoning models reject `temperature` and accept a reasoning effort;
  // non-reasoning models are the inverse. Decided by name heuristic.
  if (isReasoningModel(modelName)) {
    if (reasoningEffort) {
      // Chat completions maps this to the `reasoning_effort` request parameter.
      params.reasoning_effort = reasoningEffort;
    }
  } else {
    options.temperature = 0;
  }

  // Forwarded verbatim to the upstream request body (provider-specific).
  if (disableThinking) {
    params.thinking = { type: "disabled" };
  }

  if (Object.keys(params).length > 0) {
    options.params = params;
  }

  return options;
};

// Instantiates the Strands `OpenAIModel` from the resolved options.
export const createStrandsOpenAIModel = (options: StrandsOpenAIModelOptions): OpenAIModel =>
  new OpenAIModel(buildStrandsOpenAIModelOptions(options));
