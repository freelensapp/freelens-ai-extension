import { PreferencesStore } from "../../../common/store";
import { AIProviders, DEFAULT_OPENAI_BASE_URL } from "./ai-models";
import { findProvider } from "./model-list";
import { createStrandsOpenAIModel } from "./strands-openai-model";

import type { Model } from "@strands-agents/sdk";

// Placeholder key sent to the SDK so it populates the Authorization header; the
// AI proxy overrides it with the real key resolved in the main process, so the
// secret never travels through the renderer.
const PROXY_MANAGED_API_KEY = "freelens-proxy-managed";

const getAiProxyBaseUrl = (aiProxyPort: number | null) => {
  if (aiProxyPort === null) {
    throw new Error("AI proxy is not ready yet. Retry in a moment.");
  }

  return `http://127.0.0.1:${aiProxyPort}`;
};

export interface GetModelOptions {
  // Receives the reasoning deltas streamed by the model, when it exposes them.
  onReasoning?: (text: string) => void;
}

export const useModelProvider = () => {
  // @ts-ignore
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  // Builds a Strands model for the currently selected model. Called per run so
  // a model or endpoint change in the preferences applies to the next prompt.
  const getModel = ({ onReasoning }: GetModelOptions = {}): Model => {
    const modelName = preferencesStore.selectedModel;

    // Guard the empty-list / no-selection case: the chat UI offers a
    // "Configure models in preferences" button instead of a dropdown when no
    // model is available, but bail out clearly if we are still reached.
    if (!modelName) {
      throw new Error("No model selected. Add a model in the extension preferences.");
    }

    const provider = findProvider(preferencesStore.models, modelName) ?? AIProviders.OPEN_AI;

    switch (provider) {
      case AIProviders.OPEN_AI:
        return createStrandsOpenAIModel({
          modelName,
          apiKey: PROXY_MANAGED_API_KEY,
          upstreamBaseUrl: preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL,
          proxyBaseUrl: getAiProxyBaseUrl(preferencesStore.aiProxyPort),
          proxyToken: preferencesStore.aiProxyToken,
          reasoningEffort: preferencesStore.openAIReasoningEffort,
          disableThinking: preferencesStore.disableThinking,
          onReasoning,
        });
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  };

  return { getModel };
};
