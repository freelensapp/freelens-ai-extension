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
}

// Whether the agent has the minimum configuration to chat: at least one model
// must exist and, for OpenAI-backed models, an API key must be set. When false,
// the chat UI shows a single "Configure agent" button linking to the extension
// preferences instead of the model dropdown.
export const isAgentConfigured = ({ models, selectedModel, openAIKey, envOpenAIKey }: AgentReadinessInput): boolean => {
  if (models.length === 0) {
    return false;
  }

  const provider = findProvider(models, selectedModel) ?? models[0]?.provider;
  if (provider === AIProviders.OPEN_AI && !((envOpenAIKey ?? "").trim() || openAIKey.trim())) {
    return false;
  }

  return true;
};
