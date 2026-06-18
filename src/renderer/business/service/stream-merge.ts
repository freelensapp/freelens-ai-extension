/**
 * Helpers for merging the AI message chunks streamed by the agent into a single
 * Markdown string without gluing distinct assistant messages onto one line.
 *
 * The agent streams in `messages` mode: a single assistant message arrives as
 * many chunks that share the same `id` and must be concatenated directly (token
 * streaming). When the agent graph emits a *new* assistant message its `id`
 * changes; concatenating it straight onto the previous one produces output like
 * `...check?### Summary`, where `###` is no longer at the start of a line and
 * Markdown renders it verbatim. Inserting a blank line at the boundary keeps the
 * heading on its own block.
 */

import type { MessageContent } from "@langchain/core/messages";

export interface StreamMergeState {
  lastMessageId: string | undefined;
  started: boolean;
}

export const createStreamMergeState = (): StreamMergeState => ({
  lastMessageId: undefined,
  started: false,
});

/**
 * Flatten LangChain message content (a plain string, or an array of content
 * parts) into its text. Non-text parts such as tool-call blocks are ignored so
 * tool-call arguments are never emitted to the UI as text.
 */
export const flattenContentText = (content: MessageContent): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("");
};

/**
 * Returns the text to yield for an incoming AI message chunk, updating `state`.
 *
 * Empty chunks yield nothing. When a new assistant message begins (a defined
 * `id` that differs from the previous one) a blank-line separator is prepended
 * so the following content starts a fresh Markdown block. Chunks with no id, or
 * the same id, are concatenated directly to preserve token streaming.
 *
 * `content` may be a plain string or LangChain's structured content array; it is
 * flattened to text first, so a chunk that also carries `tool_call_chunks` still
 * contributes its preamble text instead of being dropped.
 */
export const mergeAiChunk = (state: StreamMergeState, id: string | undefined, content: MessageContent): string => {
  const text = flattenContentText(content);
  if (text.length === 0) {
    return "";
  }

  const isNewMessage = state.started && id !== undefined && id !== state.lastMessageId;
  state.lastMessageId = id;
  state.started = true;

  return isNewMessage ? `\n\n${text}` : text;
};
