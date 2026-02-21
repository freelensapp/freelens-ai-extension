import { ChatPromptTemplate } from "@langchain/core/prompts";
import useLog from "../../../common/utils/logger/logger-service";
import { AppContextType } from "../../context/application-context";
import { isOllamaModel } from "../agent/ollama-agent-helper";
import { useModelProvider } from "../provider/model-provider";
import { ANALYSIS_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";

export interface AiAnalysisService {
  analyze: (message: string) => AsyncGenerator<string, void, unknown>;
}

export const useAiAnalysisService = (applicationStatusStore: AppContextType): AiAnalysisService => {
  const { log } = useLog("useAiAnalysisService");

  const analyze = async function* (message: string) {
    log.debug("Starting AI analysis for message: ", message);

    if (!message) {
      throw new Error("No message provided for analysis.");
    }

    // Check if API key is required (not needed for Ollama models)
    const isOllama = isOllamaModel(applicationStatusStore.selectedModel);
    if (!isOllama && !applicationStatusStore.apiKey) {
      throw new Error("API key is required. Use the settings to register it.");
    }

    log.debug(`Using model: ${applicationStatusStore.selectedModel}, isOllama: ${isOllama}`);

    // Handle Ollama models differently
    if (isOllama) {
      const modelProvider = useModelProvider();
      const streamingResponse = await modelProvider.getStreamingResponse(
        [
          {
            role: "user",
            content: `${ANALYSIS_PROMPT_TEMPLATE.replace("{context}", message)}`,
          },
        ],
        { temperature: 0 },
      );

      for await (const chunk of streamingResponse.generator) {
        yield chunk;
      }

      if (streamingResponse.cleanup) {
        streamingResponse.cleanup();
      }
      return;
    }

    // Handle cloud models (OpenAI, Google)
    const model = useModelProvider().getModel();
    if (!model) {
      log.error("No model available for analysis");
      throw new Error("Model not available. Please check your configuration.");
    }

    const chain = ChatPromptTemplate.fromTemplate(ANALYSIS_PROMPT_TEMPLATE).pipe(model);
    const streamResponse = await chain.stream({ context: message });

    for await (const chunk of streamResponse) {
      if (chunk?.content) {
        yield String(chunk.content);
      }
    }
  };

  return { analyze };
};
