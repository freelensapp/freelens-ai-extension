// Pure builder for the options passed to the Strands `OpenAIModel` (chat
// completions API). Separated from the store-aware provider so the
// option-building logic (proxy routing headers, reasoning-effort vs temperature
// heuristic) can be unit-tested without the MobX store or instantiating a real
// client.
//
// Every request targets the local AI proxy (baseURL + upstream/token headers),
// which injects the real API key in the main process.

import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import OpenAI from "openai";
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
  // When true, request the upstream to disable its "thinking" mode (provider
  // specific); forwarded verbatim via `params` so it reaches the request body.
  disableThinking?: boolean;
  // Receives the model's reasoning ("chain-of-thought") deltas. The Strands chat
  // adapter drops the `reasoning_content` field OpenAI-compatible gateways
  // stream next to the answer, so it is tapped from the raw chunks instead.
  onReasoning?: (text: string) => void;
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
}: Omit<StrandsOpenAIModelOptions, "onReasoning">): OpenAIModelOptions => {
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
      // The agent runs in the Electron renderer, which the OpenAI SDK detects as
      // a browser. The key sent from here is a placeholder: the local proxy
      // injects the real one in the main process.
      dangerouslyAllowBrowser: true,
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

// Reads the reasoning text a chat-completions chunk carries. Gateways expose it
// as `reasoning_content` (DeepSeek, vLLM, LiteLLM) or `reasoning` (OpenRouter).
export const extractChunkReasoning = (chunk: unknown): string => {
  if (typeof chunk !== "object" || chunk === null) {
    return "";
  }
  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }
  const delta = (choices[0] as { delta?: Record<string, unknown> } | undefined)?.delta;
  if (!delta) {
    return "";
  }
  const reasoning = delta.reasoning_content ?? delta.reasoning;
  return typeof reasoning === "string" ? reasoning : "";
};

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === "object" && value !== null && Symbol.asyncIterator in value;

// Re-yields every streamed chunk unchanged, reporting its reasoning on the side.
async function* tapReasoning(stream: AsyncIterable<unknown>, onReasoning: (text: string) => void) {
  for await (const chunk of stream) {
    const reasoning = extractChunkReasoning(chunk);
    if (reasoning.length > 0) {
      onReasoning(reasoning);
    }
    yield chunk;
  }
}

// Wraps `chat.completions.create` so streamed responses report their reasoning
// to `onReasoning` before the Strands adapter consumes (and drops) it.
const withReasoningTap = (client: OpenAI, onReasoning: (text: string) => void): OpenAI => {
  const completions = client.chat.completions;
  const create = completions.create.bind(completions);
  const tapped = async (...args: Parameters<typeof create>) => {
    const response: unknown = await create(...args);
    return isAsyncIterable(response) ? tapReasoning(response, onReasoning) : response;
  };
  completions.create = tapped as unknown as typeof completions.create;
  return client;
};

// Instantiates the Strands `OpenAIModel` from the resolved options.
export const createStrandsOpenAIModel = ({ onReasoning, ...options }: StrandsOpenAIModelOptions): OpenAIModel => {
  const { apiKey, clientConfig, ...modelOptions } = buildStrandsOpenAIModelOptions(options);
  if (!onReasoning) {
    return new OpenAIModel({ apiKey, clientConfig, ...modelOptions });
  }
  const client = withReasoningTap(
    new OpenAI({ apiKey: typeof apiKey === "string" ? apiKey : undefined, ...clientConfig }),
    onReasoning,
  );
  return new OpenAIModel({ ...modelOptions, client });
};
