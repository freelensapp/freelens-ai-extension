import { Main } from "@freelensapp/extensions";
import { AIProviders, DEFAULT_OPENAI_BASE_URL } from "../../common/provider/ai-models";
import { findProvider } from "../../common/provider/model-list";
import { PreferencesStore } from "../../common/store";
import { DsmlAwareChatOpenAI } from "./dsml-aware-chat-model";
import { createStandardFetch } from "./host-fetch";
import { emitsDsmlToolCalls } from "./model-capabilities";
import { OfflineTokenChatOpenAI } from "./offline-token-chat-model";
import { buildOpenAIChatFields } from "./openai-fields";

// Read at call time: the namespace is the host's, and exists only once the
// extension is loaded.
const hostFetch: typeof globalThis.fetch = (input, init) => createStandardFetch(Main.Util.fetch)(input, init);

/**
 * The OpenAI API key: OPENAI_API_KEY of main's environment, else the key of the
 * preferences. Read per model, so a key changed in the preferences applies to
 * the next request. It never leaves main.
 */
export const resolveOpenAIKey = (preferencesStore: PreferencesStore): string | undefined =>
  process.env.OPENAI_API_KEY?.trim() || preferencesStore.openAIKey.trim() || undefined;

export const useModelProvider = () => {
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
        const apiKey = resolveOpenAIKey(preferencesStore);
        if (!apiKey) {
          throw new Error("No API key configured. Set it in the extension preferences or in OPENAI_API_KEY.");
        }

        const fields = buildOpenAIChatFields({
          modelName,
          apiKey,
          baseUrl: preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL,
          fetch: hostFetch,
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
