// Pure builder for the `ChatOpenAIFields` passed to `ChatOpenAI`. Separated from
// `model-provider.ts` so the option-building logic (endpoint, fetch,
// reasoning-effort vs temperature heuristic) can be unit-tested without the
// MobX store or instantiating a real client.

import { isReasoningModel } from "./model-capabilities";

import type { ChatOpenAIFields } from "@langchain/openai";

type ClientFetch = NonNullable<NonNullable<ChatOpenAIFields["configuration"]>["fetch"]>;

export interface OpenAIChatFieldsOptions {
  // Model id sent to the OpenAI API (e.g. "gpt-5.5").
  modelName: string;
  // API key used for the request.
  apiKey: string;
  // Base URL of the OpenAI-compatible endpoint (e.g. https://api.openai.com/v1).
  baseUrl: string;
  // The fetch the client sends its requests with: the host's, so the user's
  // HTTPS proxy and certificate preferences apply (see host-fetch.ts).
  fetch: ClientFetch;
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
  baseUrl,
  fetch,
  reasoningEffort,
  disableThinking,
}: OpenAIChatFieldsOptions): ChatOpenAIFields => {
  const fields: ChatOpenAIFields = {
    model: modelName,
    apiKey,
    configuration: {
      baseURL: baseUrl,
      fetch,
    },
  };

  // Reasoning models reject `temperature` and accept a reasoning effort;
  // non-reasoning models are the inverse. Decided by name heuristic.
  if (isReasoningModel(modelName)) {
    if (reasoningEffort) {
      // `@langchain/openai` v1 dropped the top-level `reasoningEffort`
      // constructor field in favor of `reasoning.effort`. The chat-completions
      // path maps `reasoning.effort` back to the `reasoning_effort` request
      // parameter.
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
