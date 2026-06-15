export enum AIProviders {
  OPEN_AI = "open-ai",
  // DEEP_SEEK = "deep-seek",
  // OLLAMA = "ollama",
  // GOOGLE = "google",
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

// Initial, editable list of models. Users can remove these and add their own.
export const DEFAULT_MODELS: CustomModel[] = [
  { provider: AIProviders.OPEN_AI, name: "gpt-5.5" },
  { provider: AIProviders.OPEN_AI, name: "gpt-5.4" },
  { provider: AIProviders.OPEN_AI, name: "gpt-5.4-mini" },
];

export const PROVIDER_LABELS: Record<AIProviders, string> = {
  [AIProviders.OPEN_AI]: "OpenAI",
  // [AIProviders.GOOGLE]: "Google",
};
