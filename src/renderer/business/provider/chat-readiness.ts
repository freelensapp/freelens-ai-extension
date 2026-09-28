// Pure helper deciding whether the agent is configured enough to start a chat.
// Kept free of any host (`@freelensapp/extensions`) or MobX dependency so it can
// be unit-tested in isolation and reused by the chat input.

import { AIProviders, type CustomModel } from "./ai-models";
import { findProvider } from "./model-list";

export interface AgentReadinessInput {
  models: CustomModel[];
  selectedModel: string;
  openAIKey: string;
  // OPENAI_API_KEY takes precedence over the stored key, matching the provider.
  envOpenAIKey?: string;
  anthropicKey?: string;
  // ANTHROPIC_API_KEY takes precedence over the stored key, matching the provider.
  envAnthropicKey?: string;
}

const hasKey = (envKey: string | undefined, storedKey: string | undefined) =>
  Boolean((envKey ?? "").trim() || (storedKey ?? "").trim());

// Whether the agent has the minimum configuration to chat: at least one model
// must exist and the selected model's provider must have an API key. When false,
// the chat UI shows a single "Configure agent" button linking to the extension
// preferences instead of the model dropdown.
export const isAgentConfigured = ({
  models,
  selectedModel,
  openAIKey,
  envOpenAIKey,
  anthropicKey,
  envAnthropicKey,
}: AgentReadinessInput): boolean => {
  if (models.length === 0) {
    return false;
  }

  const provider = findProvider(models, selectedModel) ?? models[0]?.provider;
  switch (provider) {
    case AIProviders.OPEN_AI:
      return hasKey(envOpenAIKey, openAIKey);
    case AIProviders.ANTHROPIC:
      return hasKey(envAnthropicKey, anthropicKey);
    default:
      return true;
  }
};

// Single place building the readiness input from the preferences store, so every
// feature resolves the key the same way. Invariant: chat and AI Explain must
// agree on what "configured" means, with OPENAI_API_KEY / ANTHROPIC_API_KEY
// taking precedence over the stored keys; the drift between the two resolutions caused issue #97, where
// a key provided only via the environment made the chat work but AI Explain fail.
interface ReadinessEnv {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

export const buildAgentReadinessInput = (
  prefs: { models: CustomModel[]; selectedModel: string; openAIKey: string; anthropicKey?: string },
  // Tests pass a fake environment instead of touching the real `process.env`.
  env: ReadinessEnv | undefined = typeof process !== "undefined" ? (process.env as ReadinessEnv) : undefined,
): AgentReadinessInput => ({
  models: prefs.models,
  selectedModel: prefs.selectedModel,
  openAIKey: prefs.openAIKey,
  envOpenAIKey: env?.OPENAI_API_KEY,
  anthropicKey: prefs.anthropicKey,
  envAnthropicKey: env?.ANTHROPIC_API_KEY,
});
