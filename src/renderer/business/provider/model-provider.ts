import { PreferencesStore } from "../../../common/store";
import { AIProviders, type ProviderConfig, providerBaseUrl } from "./ai-models";
import { findProvider } from "./provider-list";
import { createStrandsAnthropicModel } from "./strands-anthropic-model";
import { createStrandsOpenAIModel } from "./strands-openai-model";

import type { Model } from "@strands-agents/sdk";

// Placeholder key sent to the SDK so it populates the credential header
// (Authorization or x-api-key); the AI proxy overrides it with the real key
// resolved in the main process, so the
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

// The provider of the model selected in the chat, if it still exists.
export const selectedProvider = (preferencesStore: PreferencesStore): ProviderConfig | undefined =>
  findProvider(preferencesStore.providers, preferencesStore.selectedProviderId);

// Base URL of the endpoint the selected model is sent to, for error messages.
export const selectedEndpointBaseUrl = (preferencesStore: PreferencesStore): string => {
  const provider = selectedProvider(preferencesStore);
  return provider ? providerBaseUrl(provider) : "(no provider selected)";
};

export const useModelProvider = () => {
  // @ts-ignore
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  // Builds a Strands model for the currently selected model. Called per run so
  // a model or provider change in the preferences applies to the next prompt.
  const getModel = ({ onReasoning }: GetModelOptions = {}): Model => {
    const modelName = preferencesStore.selectedModel;
    const provider = selectedProvider(preferencesStore);

    // Guard the empty-list / no-selection case: the chat UI offers a
    // "Configure models in preferences" button instead of a dropdown when no
    // model is available, but bail out clearly if we are still reached.
    if (!modelName || !provider) {
      throw new Error("No model selected. Add a provider and a model in the extension preferences.");
    }

    const common = {
      modelName,
      apiKey: PROXY_MANAGED_API_KEY,
      providerId: provider.id,
      upstreamBaseUrl: providerBaseUrl(provider),
      proxyBaseUrl: getAiProxyBaseUrl(preferencesStore.aiProxyPort),
      proxyToken: preferencesStore.aiProxyToken,
      disableThinking: preferencesStore.disableThinking,
    };

    switch (provider.type) {
      case AIProviders.OPEN_AI:
        return createStrandsOpenAIModel({
          ...common,
          reasoningEffort: preferencesStore.openAIReasoningEffort,
          onReasoning,
        });
      case AIProviders.ANTHROPIC:
        return createStrandsAnthropicModel(common);
      default:
        throw new Error(`Unsupported provider type: ${provider.type}`);
    }
  };

  return { getModel };
};
