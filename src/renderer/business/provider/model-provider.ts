import { PreferencesStore } from "../../../common/store";
import { AIProviders, DEFAULT_OPENAI_BASE_URL } from "./ai-models";
import { DsmlAwareChatOpenAI } from "./dsml-aware-chat-model";
import { emitsDsmlToolCalls } from "./model-capabilities";
import { findProvider } from "./model-list";
import { OfflineTokenChatOpenAI } from "./offline-token-chat-model";
import { buildOpenAIChatFields } from "./openai-fields";

// Re-exported for callers that imported it from here previously; the canonical
// definition now lives next to the field builder.
export { UPSTREAM_BASE_URL_HEADER } from "./openai-fields";

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

export const useModelProvider = () => {
  // @ts-ignore
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  const getModel = () => {
    const modelName = preferencesStore.selectedModel;

    // Guard the empty-list / no-selection case: the chat UI offers a
    // "Configure models in preferences" button instead of a dropdown when no
    // model is available, but bail out clearly if we are still reached.
    if (!modelName) {
      throw new Error("No model selected. Add a model in the extension preferences.");
    }

    const provider = findProvider(preferencesStore.models, modelName) ?? AIProviders.OPEN_AI;

    switch (provider) {
      case AIProviders.OPEN_AI: {
        const openAIBaseUrl = preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;

        const fields = buildOpenAIChatFields({
          modelName,
          apiKey: PROXY_MANAGED_API_KEY,
          upstreamBaseUrl: openAIBaseUrl,
          proxyBaseUrl: getAiProxyBaseUrl(preferencesStore.aiProxyPort),
          reasoningEffort: preferencesStore.openAIReasoningEffort,
          disableThinking: preferencesStore.disableThinking,
        });

        // DeepSeek models leak their native "DSML" tool-call markup into the
        // assistant text when the endpoint has no server-side tool-call parser.
        // Use a client that recovers those tool calls so the agents can run them.
        if (emitsDsmlToolCalls(modelName)) {
          return new DsmlAwareChatOpenAI({ ...fields, streaming: true });
        }

        return new OfflineTokenChatOpenAI(fields);
      }
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  };

  return { getModel };
};
