// Pure helper deciding whether the agent is configured enough to start a chat.
// Kept free of any host (`@freelensapp/extensions`) or MobX dependency so it can
// be unit-tested in isolation and reused by the chat input.

import type { CustomModel } from "./ai-models";

export interface AgentReadinessInput {
  models: CustomModel[];
}

// Whether the chat has a model to offer. When false, the chat UI shows a single
// "Configure agent" button linking to the extension preferences instead of the
// model dropdown. Credentials are not checked here: they live in main, which
// refuses a prompt without them and says which provider to connect.
export const isAgentConfigured = ({ models }: AgentReadinessInput): boolean => models.length > 0;

// Single place building the readiness input from the preferences store, so the
// chat and AI Explain agree on what "configured" means.
export const buildAgentReadinessInput = (prefs: { models: CustomModel[] }): AgentReadinessInput => ({
  models: prefs.models,
});
