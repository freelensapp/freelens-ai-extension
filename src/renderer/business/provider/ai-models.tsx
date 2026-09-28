// The API protocol a model is reached with. Each value points at one
// user-configured endpoint (base URL + key), so any OpenAI-compatible or
// Anthropic-compatible service works, not only the vendors' own APIs. The
// "open-ai" value is persisted in the saved model list and must not change.
export enum AIProviders {
  OPEN_AI = "open-ai",
  ANTHROPIC = "anthropic",
}

// A model the user can add/remove freely. `name` is the model id sent to the
// provider API (e.g. "gpt-5.5"); the provider decides which client/key/proxy
// path is used. The list is open: model-specific behavior is decided by name
// heuristics (see model-capabilities.ts), not by a hardcoded enum.
export interface CustomModel {
  provider: AIProviders;
  name: string;
}

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

// Without "/v1": the Anthropic SDK appends "/v1/messages" itself.
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";

// Initial, editable list of models. Users can remove these and add their own.
export const DEFAULT_MODELS: CustomModel[] = [
  { provider: AIProviders.OPEN_AI, name: "gpt-5.5" },
  { provider: AIProviders.OPEN_AI, name: "gpt-5.4" },
  { provider: AIProviders.OPEN_AI, name: "gpt-5.4-mini" },
];

export const PROVIDER_LABELS: Record<AIProviders, string> = {
  [AIProviders.OPEN_AI]: "OpenAI-compatible",
  [AIProviders.ANTHROPIC]: "Anthropic-compatible",
};

// Base URL of the endpoint a provider's models are sent to, falling back to the
// vendor's own API when the preference is empty.
export const endpointBaseUrl = (
  provider: AIProviders,
  { openAIBaseUrl, anthropicBaseUrl }: { openAIBaseUrl: string; anthropicBaseUrl: string },
): string =>
  provider === AIProviders.ANTHROPIC
    ? anthropicBaseUrl || DEFAULT_ANTHROPIC_BASE_URL
    : openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;
