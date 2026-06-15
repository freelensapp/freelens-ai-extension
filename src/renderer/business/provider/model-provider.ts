// import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI, type ChatOpenAIFields } from "@langchain/openai";
import { PreferencesStore } from "../../../common/store";
import { AIProviders, DEFAULT_OPENAI_BASE_URL } from "./ai-models";
import { isReasoningModel } from "./model-capabilities";

// Header read by the local AI proxy to decide which upstream to forward to,
// letting the user configure a custom base URL without changing the proxy code.
export const UPSTREAM_BASE_URL_HEADER = "x-upstream-base-url";

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
    const provider = preferencesStore.models.find((model) => model.name === modelName)?.provider ?? AIProviders.OPEN_AI;

    switch (provider) {
      case AIProviders.OPEN_AI: {
        const openAiApiKey = process.env.OPENAI_API_KEY || preferencesStore.openAIKey;
        const openAIBaseUrl = preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;

        const fields: ChatOpenAIFields = {
          model: modelName,
          apiKey: openAiApiKey,
          configuration: {
            // The proxy strips the "/openai" prefix and forwards to the
            // upstream advertised via UPSTREAM_BASE_URL_HEADER.
            baseURL: `${getAiProxyBaseUrl(preferencesStore.aiProxyPort)}/openai`,
            defaultHeaders: {
              [UPSTREAM_BASE_URL_HEADER]: openAIBaseUrl,
            },
          },
        };

        // Reasoning models reject `temperature` and accept a reasoning effort;
        // non-reasoning models are the inverse. Decided by name heuristic.
        if (isReasoningModel(modelName)) {
          if (preferencesStore.openAIReasoningEffort) {
            fields.reasoningEffort = preferencesStore.openAIReasoningEffort as ChatOpenAIFields["reasoningEffort"];
          }
        } else {
          fields.temperature = 0;
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
