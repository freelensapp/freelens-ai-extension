import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { PreferencesStore } from "../../../common/store";
import { AIModelsEnum } from "./ai-models";

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
    switch (preferencesStore.selectedModel) {
      case AIModelsEnum.GPT_4_1:
      case AIModelsEnum.GPT_5:
      case AIModelsEnum.GPT_5_4:
      case AIModelsEnum.GPT_5_5:
        const openAiApiKey = process.env.OPENAI_API_KEY || preferencesStore.openAIKey;

        return new ChatOpenAI({
          model: preferencesStore.selectedModel,
          apiKey: openAiApiKey,
          configuration: {
            baseURL: `${getAiProxyBaseUrl(preferencesStore.aiProxyPort)}/openai/v1`,
          },
        });
      // case AIModelsEnum.DEEP_SEEK_R1:
      //   return null;
      // case AIModelsEnum.OLLAMA_LLAMA32_1B:
      // case AIModelsEnum.OLLAMA_MISTRAL_7B:
      //   const ollamaHost = process.env.FREELENS_OLLAMA_HOST || preferencesStore.ollamaHost;
      //   const ollamaPort = process.env.FREELENS_OLLAMA_PORT || preferencesStore.ollamaPort;
      //   let headers = new Headers();
      //   headers.set("Origin", ollamaHost);
      //   return new ChatOllama({
      //     model: modelName,
      //     temperature: 0,
      //     headers: headers,
      //     baseUrl: `${ollamaHost}:${ollamaPort}`,
      //   });
      case AIModelsEnum.GEMINI_2_FLASH:
        const googleApiKey = process.env.GOOGLE_API_KEY || preferencesStore.googleAIKey;
        return new ChatGoogleGenerativeAI({
          model: preferencesStore.selectedModel,
          temperature: 0,
          apiKey: googleApiKey,
          baseUrl: getAiProxyBaseUrl(preferencesStore.aiProxyPort) + "/google",
          streamUsage: false,
        });
      default:
        throw new Error(`Unsupported model: ${preferencesStore.selectedModel}`);
    }
  };

  return { getModel };
};
