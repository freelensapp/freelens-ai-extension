import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { AIModels } from "./ai-models";

const FREELENS_OLLAMA_HOST = process.env.FREELENS_OLLAMA_HOST || "http://127.0.0.1";
const FREELENS_OLLAMA_PORT = process.env.FREELENS_OLLAMA_PORT || "9898";

type ModelStrategy = {
  modelName: AIModels;
  apiKey: string;
};

export const useModelProvider = () => {
  const getModel = ({ modelName, apiKey }: ModelStrategy) => {
    switch (modelName) {
      case "gpt-3.5-turbo":
      case "o3-mini":
      case "gpt-4.1":
      case "gpt-4o":
        return new ChatOpenAI({ model: modelName, apiKey });
      case "deep-seek-r1":
        return null;
      case "llama3.2:1b":
      case "mistral:7b":
        let headers = new Headers();
        headers.set("Origin", FREELENS_OLLAMA_HOST);
        return new ChatOllama({
          model: modelName,
          temperature: 0,
          headers: headers,
          baseUrl: `${FREELENS_OLLAMA_HOST}:${FREELENS_OLLAMA_PORT}`,
        });
      case "gemini-2.0-flash":
        return new ChatGoogleGenerativeAI({
          model: modelName,
          temperature: 0,
          apiKey: apiKey,
        });
      default:
        throw new Error(`Unsupported model: ${modelName}`);
    }
  };

  return { getModel };
};
