// The API protocol a provider is reached with, so any OpenAI-compatible or
// Anthropic-compatible service works, not only the vendors' own APIs. The values
// are persisted in the saved provider list and must not change.
export enum AIProviders {
  OPEN_AI = "open-ai",
  ANTHROPIC = "anthropic",
}

// A user-configured endpoint, like an entry of the OpenCode `provider` config:
// its own name, API protocol, base URL, API key and models. `id` is stable and
// identifies the provider in the selection and in the proxy requests, so the
// name can be edited freely. `models` holds the model ids sent to the API (e.g.
// "gpt-5.5"); model-specific behavior is decided by name heuristics (see
// model-capabilities.ts), not by a hardcoded enum.
//
// `apiKey` is either the key itself, `{env:NAME}` to read it from the NAME
// environment variable, or empty to fall back to OPENAI_API_KEY /
// ANTHROPIC_API_KEY (see resolveProviderApiKey).
export interface ProviderConfig {
  id: string;
  name: string;
  type: AIProviders;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

// A model entry saved by versions before the provider list. Only read to
// migrate the old preferences (see migrateLegacyProviders).
export interface LegacyCustomModel {
  provider: AIProviders;
  name: string;
}

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

// Without "/v1": the Anthropic SDK appends "/v1/messages" itself.
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";

// Initial, editable list of OpenAI models. Users can remove these and add their own.
export const DEFAULT_OPENAI_MODELS: string[] = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];

export const PROVIDER_LABELS: Record<AIProviders, string> = {
  [AIProviders.OPEN_AI]: "OpenAI-compatible",
  [AIProviders.ANTHROPIC]: "Anthropic-compatible",
};

// Environment variable used when a provider has no API key of its own.
export const PROVIDER_ENV_KEYS: Record<AIProviders, string> = {
  [AIProviders.OPEN_AI]: "OPENAI_API_KEY",
  [AIProviders.ANTHROPIC]: "ANTHROPIC_API_KEY",
};

export const defaultBaseUrl = (type: AIProviders): string =>
  type === AIProviders.ANTHROPIC ? DEFAULT_ANTHROPIC_BASE_URL : DEFAULT_OPENAI_BASE_URL;

// Base URL of the endpoint a provider's models are sent to, falling back to the
// vendor's own API when the field is empty.
export const providerBaseUrl = (provider: Pick<ProviderConfig, "type" | "baseUrl">): string =>
  provider.baseUrl.trim() || defaultBaseUrl(provider.type);

// Initial provider list for a fresh install.
export const createDefaultProviders = (): ProviderConfig[] => [
  {
    id: "openai",
    name: "OpenAI",
    type: AIProviders.OPEN_AI,
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    apiKey: "",
    models: [...DEFAULT_OPENAI_MODELS],
  },
];
