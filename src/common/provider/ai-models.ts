export enum AIProviders {
  OPEN_AI = "open-ai",
  // DEEP_SEEK = "deep-seek",
}

// A model the user can add/remove freely. `name` is the model id sent to the
// provider API (e.g. "gpt-6.1-sol"); the provider decides which client/key/proxy
// path is used. The list is open: model-specific behavior is decided by name
// heuristics (see model-capabilities.ts), not by a hardcoded enum.
export interface CustomModel {
  provider: AIProviders;
  name: string;
}

export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

// Initial, editable list of models: the flagship models of the OpenAI API.
// Users can remove these and add their own. The first one is the initial
// selection: GPT-6.1 Sol, the balance of capability and cost, rather than the
// five times dearer GPT-6 Astra.
export const DEFAULT_MODELS: CustomModel[] = [
  { provider: AIProviders.OPEN_AI, name: "gpt-6.1-sol" },
  { provider: AIProviders.OPEN_AI, name: "gpt-6-astra" },
  { provider: AIProviders.OPEN_AI, name: "gpt-6.1-terra" },
  { provider: AIProviders.OPEN_AI, name: "gpt-6-luna" },
];

export const PROVIDER_LABELS: Record<AIProviders, string> = {
  [AIProviders.OPEN_AI]: "OpenAI",
};
