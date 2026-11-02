import { type LanguageModel, streamText } from "ai";
import { buildAgentReadinessInput, isAgentConfigured } from "../../common/provider/chat-readiness";
import { PreferencesStore } from "../../common/store";
import { useModelProvider } from "../provider/model-provider";
import { analysisPrompt } from "../provider/prompt-template-provider";
import useLog from "../utils/logger";

export interface AiAnalysisService {
  analyze: (message: string, signal: AbortSignal) => AsyncGenerator<string, void, unknown>;
}

// Explain: one streamed model call over the text of an event or an object. The
// AI SDK retries a failed request itself (`maxRetries`, 2 by default) before
// the answer starts.
export const useAiAnalysisService = (getModel: () => LanguageModel = () => useModelProvider().getModel()) => {
  const { log } = useLog("useAiAnalysisService");

  const analyze = async function* (message: string, signal: AbortSignal) {
    log.debug("Starting AI analysis for message: ", message);

    if (!message) {
      throw new Error("No message provided for analysis.");
    }

    // Same readiness check as the chat input, so a key provided only through the
    // OPENAI_API_KEY environment variable works here too.
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
    if (!isAgentConfigured(buildAgentReadinessInput(preferencesStore))) {
      throw new Error("The agent is not configured. Use the settings to add a model and register the API key.");
    }

    const result = streamText({ model: getModel(), prompt: analysisPrompt(message), abortSignal: signal });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          if (part.text) {
            yield part.text;
          }
          break;
        case "error":
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
        case "abort":
          throw new Error("The analysis was aborted.");
      }
    }
  };

  return { analyze } satisfies AiAnalysisService;
};
