// Summarizes a session's model-side history into a single compact summary used
// to replace that history when the conversation approaches the model's input
// token limit. The decision math and prompt assembly are the pure helpers in
// session-compaction.ts; this module owns the impure model call.

import { generateText, type LanguageModel } from "ai";
import {
  buildSummaryPrompt,
  type HistoryMessageLike,
  toSummarizableMessages,
} from "../../common/service/session-compaction";

export interface SessionCompactionService {
  // Summarize the given model-side history into a single compact summary string.
  // Returns an empty string when there is nothing to summarize.
  summarize(messages: HistoryMessageLike[]): Promise<string>;
}

export const useSessionCompactionService = (getModel: () => LanguageModel): SessionCompactionService => {
  const summarize = async (messages: HistoryMessageLike[]): Promise<string> => {
    const summarizable = toSummarizableMessages(messages);
    if (summarizable.every((message) => message.content.trim().length === 0)) {
      return "";
    }

    const { text } = await generateText({ model: getModel(), prompt: buildSummaryPrompt(summarizable) });
    return text.trim();
  };

  return { summarize };
};
