import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { PreferencesStore } from "../../../common/store";
import { AIModelsEnum } from "./ai-models";

export const useModelProvider = () => {
  // @ts-ignore
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  const getModel = () => {
    switch (preferencesStore.selectedModel) {
      case AIModelsEnum.GPT_3_5_TURBO:
      case AIModelsEnum.O3_MINI:
      case AIModelsEnum.GPT_4_1:
      case AIModelsEnum.GPT_4_O:
      case AIModelsEnum.GPT_5:
        const openAiApiKey = process.env.OPENAI_API_KEY || preferencesStore.openAIKey;
        return new ChatOpenAI({ model: preferencesStore.selectedModel, apiKey: openAiApiKey });
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
          streamUsage: false,
        });
      default:
        throw new Error(`Unsupported model: ${preferencesStore.selectedModel}`);
    }
  };

  return { getModel };
};
