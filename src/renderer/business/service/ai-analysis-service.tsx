import { Agent } from "@strands-agents/sdk";
import { PreferencesStore } from "../../../common/store";
import useLog from "../../../common/utils/logger/logger-service";
import { buildAgentReadinessInput, isAgentConfigured } from "../provider/chat-readiness";
import { useModelProvider } from "../provider/model-provider";
import { ANALYSIS_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";

const MAX_GEMINI_STREAM_RETRIES = 3;
const BASE_BACKOFF_MS = 700;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isGeminiTransientError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("failed to parse stream") ||
    message.includes("503") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("429") ||
    message.includes("too many requests")
  );
};

const getRetryDelay = (attempt: number) => {
  const jitter = Math.floor(Math.random() * 250);

  return BASE_BACKOFF_MS * 2 ** (attempt - 1) + jitter;
};

export interface AiAnalysisService {
  analyze: (message: string) => AsyncGenerator<string, void, unknown>;
}

export const useAiAnalysisService = (): AiAnalysisService => {
  const { log } = useLog("useAiAnalysisService");

  const analyze = async function* (message: string) {
    log.debug("Starting AI analysis for message: ", message);

    if (!message) {
      throw new Error("No message provided for analysis.");
    }

    // Same readiness check as the chat input, so a key provided only through the
    // OPENAI_API_KEY / ANTHROPIC_API_KEY environment variables works here too.
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
    if (!isAgentConfigured(buildAgentReadinessInput(preferencesStore))) {
      throw new Error("The agent is not configured. Use the settings to add a model and register the API key.");
    }

    const prompt = ANALYSIS_PROMPT_TEMPLATE.replace("{context}", message);

    for (let attempt = 1; attempt <= MAX_GEMINI_STREAM_RETRIES + 1; attempt++) {
      let hasYieldedContent = false;

      try {
        // A throwaway, tool-less agent per attempt: a single streamed model call
        // with no history, so a retry never re-sends a failed attempt.
        const analyzer = new Agent({ model: useModelProvider().getModel(), printer: false, retryStrategy: null });

        for await (const event of analyzer.stream(prompt)) {
          if (
            event.type === "modelStreamUpdateEvent" &&
            event.event.type === "modelContentBlockDeltaEvent" &&
            event.event.delta.type === "textDelta" &&
            event.event.delta.text.length > 0
          ) {
            hasYieldedContent = true;
            yield event.event.delta.text;
          }
        }

        return;
      } catch (error) {
        const canRetry = !hasYieldedContent && isGeminiTransientError(error) && attempt <= MAX_GEMINI_STREAM_RETRIES;

        if (!canRetry) {
          throw error;
        }

        await wait(getRetryDelay(attempt));
      }
    }
  };

  return { analyze };
};
