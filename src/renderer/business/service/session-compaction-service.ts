// Summarizes a session's agent history into a single compact summary used to
// replace that history when the conversation approaches the model's input
// token limit. The decision math and prompt assembly are the pure helpers in
// session-compaction.ts; this module owns the impure model invocation.

import { Agent } from "@strands-agents/sdk";
import { useModelProvider } from "../provider/model-provider";
import { messageContentToText } from "../provider/token-estimate";
import { buildSummaryPrompt, type HistoryMessageLike, toSummarizableMessages } from "./session-compaction";

export interface SessionCompactionService {
  // Summarize the given agent history into a single compact summary string.
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

    // A throwaway, tool-less agent: one model call, no session persistence.
    const summarizer = new Agent({ model: getModel(), printer: false });
    const result = await summarizer.invoke(buildSummaryPrompt(summarizable));
    return messageContentToText(result.lastMessage.content).trim();
  };

  return { summarize };
};
