// Pure helper deciding whether AI Explain, which still runs on the old OpenAI
// client, has a model. Kept free of any host or MobX dependency so it can be
// unit-tested in isolation. The chat uses the model picker instead.

import type { CustomModel } from "./ai-models";

export interface AgentReadinessInput {
  models: CustomModel[];
}

// Whether AI Explain has a model to run on. Credentials are not checked here:
// they live in main.
export const isAgentConfigured = ({ models }: AgentReadinessInput): boolean => models.length > 0;

// Builds the readiness input from the preferences store.
export const buildAgentReadinessInput = (prefs: { models: CustomModel[] }): AgentReadinessInput => ({
  models: prefs.models,
});
