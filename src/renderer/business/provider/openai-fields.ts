// Pure builder for the `ChatOpenAIFields` passed to `ChatOpenAI`. Separated from
// `model-provider.ts` so the option-building logic (proxy routing header,
// reasoning-effort vs temperature heuristic) can be unit-tested without the
// MobX store or instantiating a real client.

import { isReasoningModel } from "./model-capabilities";

import type { ChatOpenAIFields } from "@langchain/openai";

// Header read by the local AI proxy to decide which upstream to forward to,
// letting the user configure a custom base URL without changing the proxy code.
export const UPSTREAM_BASE_URL_HEADER = "x-upstream-base-url";

export interface OpenAIChatFieldsOptions {
  // Model id sent to the OpenAI API (e.g. "gpt-5.5").
  modelName: string;
  // API key used for the request.
  apiKey: string;
  // Full upstream base URL advertised to the proxy (e.g. https://api.openai.com/v1).
  upstreamBaseUrl: string;
  // Local proxy origin (e.g. http://127.0.0.1:<port>); the "/openai" prefix is appended.
  proxyBaseUrl: string;
  // Optional reasoning effort; applied only to reasoning-capable models.
  reasoningEffort?: string;
  // When true, request the upstream to disable its "thinking" mode. Some
  // providers (e.g. DeepSeek via LiteLLM) expose a thinking mode that is
  // mutually exclusive with the forced `tool_choice` the supervisor agent uses
  // for structured output, failing with "Thinking mode does not support this
  // tool_choice". User-controlled because it is provider-specific.
  disableThinking?: boolean;
}

export const buildOpenAIChatFields = ({
  modelName,
  apiKey,
  upstreamBaseUrl,
  proxyBaseUrl,
  reasoningEffort,
  disableThinking,
}: OpenAIChatFieldsOptions): ChatOpenAIFields => {
  const fields: ChatOpenAIFields = {
    model: modelName,
    apiKey,
    configuration: {
      // The proxy strips the "/openai" prefix and forwards to the upstream
      // advertised via UPSTREAM_BASE_URL_HEADER.
      baseURL: `${proxyBaseUrl}/openai`,
      defaultHeaders: {
        [UPSTREAM_BASE_URL_HEADER]: upstreamBaseUrl,
      },
    },
  };

  // Reasoning models reject `temperature` and accept a reasoning effort;
  // non-reasoning models are the inverse. Decided by name heuristic.
  if (isReasoningModel(modelName)) {
    if (reasoningEffort) {
      // `@langchain/openai` v1 dropped the top-level `reasoningEffort`
      // constructor field in favor of `reasoning.effort`. The chat-completions
      // path (used through our proxy) maps `reasoning.effort` back to the
      // `reasoning_effort` request parameter.
      fields.reasoning = { effort: reasoningEffort as NonNullable<ChatOpenAIFields["reasoning"]>["effort"] };
    }
  } else {
    fields.temperature = 0;
  }

  // Sent via `modelKwargs` so it reaches the upstream request body verbatim
  // without being passed as a typed field that providers like OpenAI reject.
  if (disableThinking) {
    fields.modelKwargs = { ...fields.modelKwargs, thinking: { type: "disabled" } };
  }

  return fields;
};
