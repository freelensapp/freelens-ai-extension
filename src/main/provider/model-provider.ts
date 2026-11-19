import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Main } from "@freelensapp/extensions";
import { defaultSettingsMiddleware, type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { AIProviders, DEFAULT_OPENAI_BASE_URL } from "../../common/provider/ai-models";
import { findProvider } from "../../common/provider/model-list";
import { PreferencesStore } from "../../common/store";
import { dsmlToolCallMiddleware } from "./dsml-middleware";
import { emitsDsmlToolCalls } from "./model-capabilities";
import { buildOpenAIModelOptions, COMPATIBLE_PROVIDER_NAME } from "./openai-fields";

// Read at call time: the namespace is the host's, and exists only once the
// extension is loaded.
const hostFetch: typeof globalThis.fetch = (input, init) => Main.Util.fetch(input, init);

/**
 * The OpenAI API key: OPENAI_API_KEY of main's environment, else the key of the
 * preferences. Read per model, so a key changed in the preferences applies to
 * the next request. It never leaves main.
 */
export const resolveOpenAIKey = (preferencesStore: PreferencesStore): string | undefined =>
  process.env.OPENAI_API_KEY?.trim() || preferencesStore.openAIKey.trim() || undefined;

export const useModelProvider = () => {
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  /**
   * The selected model as a `LanguageModel` of the AI SDK, with its default
   * call settings (temperature, provider options) applied by a middleware, so
   * every caller (the agents, Explain, compaction) sends the same request.
   */
  const getModel = (): LanguageModel => {
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

        const baseURL = preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;
        const { api, temperature, providerOptions } = buildOpenAIModelOptions({
          modelName,
          baseUrl: baseURL,
          reasoningEffort: preferencesStore.openAIReasoningEffort,
          disableThinking: preferencesStore.disableThinking,
        });

        const model =
          api === "compatible"
            ? createOpenAICompatible({
                name: COMPATIBLE_PROVIDER_NAME,
                baseURL,
                apiKey,
                fetch: hostFetch,
                // The usage of a streamed answer, which a gateway sends only
                // when it is asked for.
                includeUsage: true,
              }).chatModel(modelName)
            : createOpenAI({ baseURL, apiKey, fetch: hostFetch })[api](modelName);

        const middleware: LanguageModelMiddleware[] = [
          defaultSettingsMiddleware({ settings: { temperature, providerOptions } }),
        ];
        // DeepSeek models leak their native "DSML" tool-call markup into the
        // assistant text when the endpoint has no server-side tool-call parser.
        // Recover those tool calls so the agents can run them.
        if (emitsDsmlToolCalls(modelName)) {
          middleware.push(dsmlToolCallMiddleware);
        }

        return wrapLanguageModel({ model, middleware });
      }
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  };

  return { getModel };
};
