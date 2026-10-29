import { ChatPromptTemplate } from "@langchain/core/prompts";
import { buildAgentReadinessInput, isAgentConfigured } from "../../common/provider/chat-readiness";
import { PreferencesStore } from "../../common/store";
import { useModelProvider } from "../provider/model-provider";
import { ANALYSIS_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";
import useLog from "../utils/logger";
import { flattenContentText } from "./stream-merge";
import { wait } from "./wait";

const MAX_GEMINI_STREAM_RETRIES = 3;
const BASE_BACKOFF_MS = 700;

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
  analyze: (message: string, signal: AbortSignal) => AsyncGenerator<string, void, unknown>;
}

export const useAiAnalysisService = (): AiAnalysisService => {
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

    const model = useModelProvider().getModel();
    if (!model) {
      return;
    }

    const chain = ChatPromptTemplate.fromTemplate(ANALYSIS_PROMPT_TEMPLATE).pipe(model);

    for (let attempt = 1; attempt <= MAX_GEMINI_STREAM_RETRIES + 1; attempt++) {
      let hasYieldedContent = false;

      try {
        const streamResponse = await chain.stream({ context: message }, { signal });

        for await (const chunk of streamResponse) {
          // The Responses API streams the content as an array of blocks, Chat
          // Completions as a string.
          const text = chunk ? flattenContentText(chunk.content) : "";
          if (text) {
            hasYieldedContent = true;
            yield text;
          }
        }

        return;
      } catch (error) {
        const canRetry =
          !signal.aborted &&
          !hasYieldedContent &&
          isGeminiTransientError(error) &&
          attempt <= MAX_GEMINI_STREAM_RETRIES;

        if (!canRetry) {
          throw error;
        }

        await wait(getRetryDelay(attempt), signal);
      }
    }
  };

  return { analyze };
};
