// import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { PreferencesStore } from "../../../common/store";
import { AIProviders, DEFAULT_OPENAI_BASE_URL } from "./ai-models";
import { DsmlAwareChatOpenAI } from "./dsml-aware-chat-model";
import { emitsDsmlToolCalls } from "./model-capabilities";
import { findProvider } from "./model-list";
import { buildOpenAIChatFields } from "./openai-fields";

// Re-exported for callers that imported it from here previously; the canonical
// definition now lives next to the field builder.
export { UPSTREAM_BASE_URL_HEADER } from "./openai-fields";

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
        const openAiApiKey = process.env.OPENAI_API_KEY || preferencesStore.openAIKey;
        const openAIBaseUrl = preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;

        const fields = buildOpenAIChatFields({
          modelName,
          apiKey: openAiApiKey,
          upstreamBaseUrl: openAIBaseUrl,
          proxyBaseUrl: getAiProxyBaseUrl(preferencesStore.aiProxyPort),
          reasoningEffort: preferencesStore.openAIReasoningEffort,
          disableThinking: preferencesStore.disableThinking,
        });

        // DeepSeek models leak their native "DSML" tool-call markup into the
        // assistant text when the endpoint has no server-side tool-call parser.
        // Use a client that recovers those tool calls so the agents can run them.
        if (emitsDsmlToolCalls(modelName)) {
          return new DsmlAwareChatOpenAI(fields);
        }

        return new ChatOpenAI(fields);
      }
      // case AIProviders.OLLAMA: {
      //   const ollamaHost = process.env.FREELENS_OLLAMA_HOST || preferencesStore.ollamaHost;
      //   const ollamaPort = process.env.FREELENS_OLLAMA_PORT || preferencesStore.ollamaPort;
      //   const headers = new Headers();
      //   headers.set("Origin", ollamaHost);
      //   return new ChatOllama({
      //     model: modelName,
      //     temperature: 0,
      //     headers: headers,
      //     baseUrl: `${ollamaHost}:${ollamaPort}`,
      //   });
      // }
      // case AIProviders.GOOGLE: {
      //   const googleApiKey = process.env.GOOGLE_API_KEY || preferencesStore.googleAIKey;
      //   return new ChatGoogleGenerativeAI({
      //     model: modelName,
      //     temperature: 0,
      //     apiKey: googleApiKey,
      //     baseUrl: getAiProxyBaseUrl(preferencesStore.aiProxyPort) + "/google",
      //     streamUsage: false,
      //   });
      // }
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  };

  return { getModel };
};
