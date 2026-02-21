import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { Message } from "ollama";
import { PreferencesStore } from "../../../common/store";
import { createLogger } from "../../../common/utils/logger/logger-service";
import { isOllamaModel } from "../agent/ollama-agent-helper";
import { AIModelsEnum } from "./ai-models";
import { createOpenAiCompatibleOllamaService, OllamaService } from "./ollama-service";

/**
 * Interface for streaming AI responses.
 */
export interface StreamingResponse {
  /**
   * Async generator for streaming response chunks.
   */
  generator: AsyncGenerator<string>;

  /**
   * Cleanup function to call when done.
   */
  cleanup?: () => void;
}

/**
 * Provider for accessing AI models with a unified interface.
 * Supports OpenAI, Google AI, and local Ollama models.
 */
export const useModelProvider = () => {
  const { log } = createLogger("useModelProvider");
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  /**
   * Gets a LangChain model instance for agent operations (including tool calling).
   * Supports OpenAI, Google AI, and Ollama models via OpenAI-compatible API.
   */
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
      case AIModelsEnum.OLLAMA_GRANITE4_3B:
        const ollamaHost = process.env.FREELENS_OLLAMA_HOST || preferencesStore.ollamaHost;
        const ollamaPort = process.env.FREELENS_OLLAMA_PORT || preferencesStore.ollamaPort;

        return createOpenAiCompatibleOllamaService(preferencesStore.selectedModel, ollamaHost, ollamaPort, log);

      default:
        throw new Error(`Unsupported model: ${preferencesStore.selectedModel}`);
    }
  };

  /**
   * Creates an Ollama service instance with current settings.
   * @returns Configured OllamaService instance
   */
  const createOllamaService = (): OllamaService => {
    const ollamaHost = process.env.FREELENS_OLLAMA_HOST || preferencesStore.ollamaHost;
    const ollamaPort = process.env.FREELENS_OLLAMA_PORT || preferencesStore.ollamaPort;

    log.debug(`Creating Ollama service with host: ${ollamaHost}, port: ${ollamaPort}`);

    return new OllamaService({
      host: ollamaHost,
      port: parseInt(ollamaPort, 10),
    });
  };

  /**
   * Gets a streaming response from the selected model.
   * Handles both LangChain models (OpenAI, Google) and Ollama models.
   *
   * @param messages - Array of conversation messages
   * @param options - Optional generation settings
   * @returns Streaming response object
   */
  const getStreamingResponse = async (
    messages: Message[],
    options?: {
      temperature?: number;
      maxTokens?: number;
    },
  ): Promise<StreamingResponse> => {
    const modelName = preferencesStore.selectedModel;
    const isOllamaProvider = isOllamaModel(modelName);

    log.debug(`Getting streaming response for model: ${modelName}, is-ollama: ${isOllamaProvider}`);

    // Handle Ollama models
    if (isOllamaProvider) {
      const ollamaService = createOllamaService();

      // Set handbook content if available
      try {
        const { handbookCache } = require("../../../common/utils/kubectl-handbook-loader");
        const handbookContent = await handbookCache.getOrLoad();
        ollamaService.setHandbookContent(handbookContent);
      } catch {
        log.warn("Failed to load kubectl handbook for context:");
      }

      const generator = ollamaService.generateChatResponse(modelName, messages, {
        stream: true,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      });

      return {
        generator,
        cleanup: () => {
          // Cleanup if needed
        },
      };
    }

    // Handle LangChain models (OpenAI, Google)
    const langChainModel = getModel();
    if (!langChainModel) {
      throw new Error(`Model ${modelName} is not available`);
    }

    // Convert Ollama-style messages to LangChain format
    const lastMessage = messages[messages.length - 1];
    const context = messages
      .filter((m) => m.role !== "user")
      .map((m) => m.content)
      .join("\n");

    // For LangChain, we use a simple approach with the last user message
    // and context from previous messages
    const prompt = context ? `${context}\n\nUser: ${lastMessage?.content || ""}` : lastMessage?.content || "";

    const streamResponse = await langChainModel.stream(prompt);

    return {
      generator: (async function* () {
        for await (const chunk of streamResponse) {
          if (chunk?.content) {
            yield String(chunk.content);
          }
        }
      })(),
      cleanup: () => {
        // Cleanup if needed
      },
    };
  };

  /**
   * Checks if the current model service is available.
   * @returns Promise resolving to availability status
   */
  const isServiceAvailable = async (): Promise<boolean> => {
    const modelName = preferencesStore.selectedModel;
    const isOllamaProvider = isOllamaModel(modelName);

    if (isOllamaProvider) {
      try {
        const ollamaService = createOllamaService();
        const health = await ollamaService.isServiceAvailable();
        return health.isHealthy;
      } catch {
        return false;
      }
    }

    // For cloud providers, we assume availability if API key is present
    return !!preferencesStore.openAIKey || !!preferencesStore.googleAIKey;
  };

  /**
   * Gets available models from the current provider.
   * @returns Promise resolving to array of available model names
   */
  const getAvailableModels = async (): Promise<string[]> => {
    const modelName = preferencesStore.selectedModel;
    const isOllamaProvider = isOllamaModel(modelName);

    if (isOllamaProvider) {
      try {
        const ollamaService = createOllamaService();
        return await ollamaService.getAvailableModels();
      } catch {
        return [];
      }
    }

    // Return single model for cloud providers
    return [modelName];
  };

  return {
    getModel,
    getStreamingResponse,
    isServiceAvailable,
    getAvailableModels,
    createOllamaService,
  };
};
