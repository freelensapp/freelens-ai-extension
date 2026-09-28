// Pure helper deciding whether the agent is configured enough to start a chat.
// Kept free of any host (`@freelensapp/extensions`) or MobX dependency so it can
// be unit-tested in isolation and reused by the chat input.

import { type ProviderConfig } from "./ai-models";
import { findProvider, resolveProviderApiKey } from "./provider-list";

type Env = Record<string, string | undefined>;

export interface AgentReadinessInput {
  providers: ProviderConfig[];
  selectedProviderId: string;
  selectedModel: string;
  // Environment the provider keys are resolved against ({env:NAME} references
  // and the OPENAI_API_KEY / ANTHROPIC_API_KEY fallbacks).
  env?: Env;
}

// Whether the agent has the minimum configuration to chat: the selected model
// must exist and its provider must have an API key. When false, the chat UI
// shows a single "Configure agent" button linking to the extension preferences
// instead of the model dropdown.
export const isAgentConfigured = ({
  providers,
  selectedProviderId,
  selectedModel,
  env,
}: AgentReadinessInput): boolean => {
  const provider = findProvider(providers, selectedProviderId);
  if (!provider || !provider.models.includes(selectedModel)) {
    return false;
  }

  return resolveProviderApiKey(provider, env) !== undefined;
};

// Single place building the readiness input from the preferences store, so every
// feature resolves the key the same way. Invariant: chat and AI Explain must
// agree on what "configured" means, and both must resolve the key like the
// main-process proxy (resolveProviderApiKey); the drift between two resolutions
// caused issue #97, where a key provided only via the environment made the chat
// work but AI Explain fail.
export const buildAgentReadinessInput = (
  prefs: { providers: ProviderConfig[]; selectedProviderId: string; selectedModel: string },
  // Tests pass a fake environment instead of touching the real `process.env`.
  env: Env | undefined = typeof process !== "undefined" ? (process.env as Env) : undefined,
): AgentReadinessInput => ({
  providers: prefs.providers,
  selectedProviderId: prefs.selectedProviderId,
  selectedModel: prefs.selectedModel,
  env,
});
