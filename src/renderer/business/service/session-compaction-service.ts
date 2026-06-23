// Summarizes a session's model-side history into a single compact summary used
// to replace that history when the conversation approaches the model's input
// token limit. The decision math and prompt assembly are the pure helpers in
// session-compaction.ts; this module owns the impure model invocation.

import { useModelProvider } from "../provider/model-provider";
import { messageContentToText } from "../provider/token-estimate";
import { buildSummaryPrompt, type HistoryMessageLike, toSummarizableMessages } from "./session-compaction";

export interface SessionCompactionService {
  // Summarize the given model-side history into a single compact summary string.
  // Returns an empty string when there is nothing to summarize.
  summarize(messages: HistoryMessageLike[]): Promise<string>;
}

export const useSessionCompactionService = (): SessionCompactionService => {
  const { getModel } = useModelProvider();

  const summarize = async (messages: HistoryMessageLike[]): Promise<string> => {
    const summarizable = toSummarizableMessages(messages);
    if (summarizable.every((message) => message.content.trim().length === 0)) {
      return "";
    }

    const response = await getModel().invoke(buildSummaryPrompt(summarizable));
    return messageContentToText(response.content).trim();
  };

  return { summarize };
};
