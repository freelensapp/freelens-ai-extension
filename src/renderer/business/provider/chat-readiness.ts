// Pure helper deciding whether the agent is configured enough to start a chat.
// Kept free of any host (`@freelensapp/extensions`) or MobX dependency so it can
// be unit-tested in isolation and reused by the chat input.

import { AIProviders, type CustomModel } from "../../../common/provider/ai-models";
import { findProvider } from "../../../common/provider/model-list";

export interface AgentReadinessInput {
  models: CustomModel[];
  selectedModel: string;
  openAIKey: string;
  // Whether OPENAI_API_KEY is set in main's environment. It takes precedence
  // over the stored key, matching the provider.
  envOpenAIKeyAvailable?: boolean;
}

// Whether the agent has the minimum configuration to chat: at least one model
// must exist and, for OpenAI-backed models, an API key must be set. When false,
// the chat UI shows a single "Configure agent" button linking to the extension
// preferences instead of the model dropdown.
export const isAgentConfigured = ({
  models,
  selectedModel,
  openAIKey,
  envOpenAIKeyAvailable,
}: AgentReadinessInput): boolean => {
  if (models.length === 0) {
    return false;
  }

  const provider = findProvider(models, selectedModel) ?? models[0]?.provider;
  if (provider === AIProviders.OPEN_AI && !(envOpenAIKeyAvailable || openAIKey.trim())) {
    return false;
  }

  return true;
};

// Single place building the readiness input from the preferences store, so every
// feature resolves the key the same way. Invariant: chat and AI Explain must
// agree on what "configured" means, with OPENAI_API_KEY taking precedence over
// the stored key; the drift between the two resolutions caused issue #97, where
// a key provided only via the environment made the chat work but AI Explain fail.
// The environment is main's: main sets `openAIKeyFromEnvironment` in the store.
export const buildAgentReadinessInput = (prefs: {
  models: CustomModel[];
  selectedModel: string;
  openAIKey: string;
  openAIKeyFromEnvironment?: boolean;
}): AgentReadinessInput => ({
  models: prefs.models,
  selectedModel: prefs.selectedModel,
  openAIKey: prefs.openAIKey,
  envOpenAIKeyAvailable: prefs.openAIKeyFromEnvironment,
});
