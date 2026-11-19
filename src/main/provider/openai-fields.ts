// Pure builder for how the selected model is called: which API of which AI SDK
// provider, and the call settings. Separated from `model-provider.ts` so the
// option-building logic (API choice, reasoning-effort vs temperature
// heuristic, Responses options) can be unit-tested without the MobX store or a
// real client.

import { DEFAULT_OPENAI_BASE_URL } from "../../common/provider/ai-models";
import { isReasoningModel, requiresResponsesApi } from "./model-capabilities";

import type { JSONObject } from "@ai-sdk/provider";

// The name the OpenAI-compatible provider is created with. Its provider options
// are read under this name, and every key of them that is not one of its own
// options goes into the request body as it is.
export const COMPATIBLE_PROVIDER_NAME = "openaiCompatible";

// - `responses`: `@ai-sdk/openai`, Responses API.
// - `chat`: `@ai-sdk/openai`, Chat Completions, for the OpenAI API itself.
// - `compatible`: `@ai-sdk/openai-compatible`, Chat Completions, for any other
//   base URL (LiteLLM, vLLM, Ollama, DeepSeek).
export type OpenAIModelApi = "responses" | "chat" | "compatible";

export interface OpenAIModelOptionsInput {
  // Model id sent to the endpoint (e.g. "gpt-6.1-sol").
  modelName: string;
  // Base URL of the OpenAI-compatible endpoint (e.g. https://api.openai.com/v1).
  baseUrl: string;
  // Optional reasoning effort; applied only to reasoning-capable models.
  reasoningEffort?: string;
  // When true, request the upstream to disable its "thinking" mode. Some
  // providers (e.g. DeepSeek via LiteLLM) expose a thinking mode that rejects
  // a forced `tool_choice`. User-controlled because it is provider-specific.
  disableThinking?: boolean;
}

export interface OpenAIModelOptions {
  api: OpenAIModelApi;
  // The default call settings of the model, applied by a middleware.
  temperature?: number;
  providerOptions: Record<string, JSONObject>;
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, "");

export const isOpenAIBaseUrl = (baseUrl: string): boolean =>
  normalizeBaseUrl(baseUrl) === normalizeBaseUrl(DEFAULT_OPENAI_BASE_URL);

export const buildOpenAIModelOptions = ({
  modelName,
  baseUrl,
  reasoningEffort,
  disableThinking,
}: OpenAIModelOptionsInput): OpenAIModelOptions => {
  // Models that take their tools only through the Responses API, at any base
  // URL: a gateway such as LiteLLM serves Responses too. The conversation is
  // kept in the extension's store and re-sent with every request, as on Chat
  // Completions, so nothing is stored by OpenAI (`store: false`, which also
  // keeps item ids out of the request), and the reasoning of a tool loop is
  // replayed from its encrypted content. Function tools are sent non-strict,
  // the AI SDK's default for a tool without `strict`, and keep their optional
  // arguments.
  const api: OpenAIModelApi = requiresResponsesApi(modelName)
    ? "responses"
    : isOpenAIBaseUrl(baseUrl)
      ? "chat"
      : "compatible";
  const providerName = api === "compatible" ? COMPATIBLE_PROVIDER_NAME : "openai";

  const options: JSONObject = {};
  if (api === "responses") {
    options.store = false;
    options.include = ["reasoning.encrypted_content"];
  }

  // Reasoning models reject `temperature` and accept a reasoning effort;
  // non-reasoning models are the inverse. Decided by name heuristic.
  let temperature: number | undefined;
  if (isReasoningModel(modelName)) {
    if (reasoningEffort) {
      options.reasoningEffort = reasoningEffort;
    }
  } else {
    temperature = 0;
  }

  // An option the OpenAI-compatible provider does not know goes into the
  // request body verbatim. The OpenAI provider validates its options, so the
  // flag applies to other base URLs only, which is where the providers that
  // know it are reached.
  if (disableThinking && api === "compatible") {
    options.thinking = { type: "disabled" };
  }

  return {
    api,
    ...(temperature === undefined ? {} : { temperature }),
    providerOptions: { [providerName]: options },
  };
};
