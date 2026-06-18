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

export interface StreamMergeState {
  lastMessageId: string | undefined;
  started: boolean;
}

export const createStreamMergeState = (): StreamMergeState => ({
  lastMessageId: undefined,
  started: false,
});

/**
 * Returns the text to yield for an incoming AI message chunk, updating `state`.
 *
 * Empty chunks yield nothing. When a new assistant message begins (a defined
 * `id` that differs from the previous one) a blank-line separator is prepended
 * so the following content starts a fresh Markdown block. Chunks with no id, or
 * the same id, are concatenated directly to preserve token streaming.
 */
export const mergeAiChunk = (state: StreamMergeState, id: string | undefined, content: string): string => {
  if (content.length === 0) {
    return "";
  }

  const isNewMessage = state.started && id !== undefined && id !== state.lastMessageId;
  state.lastMessageId = id;
  state.started = true;

  return isNewMessage ? `\n\n${content}` : content;
};
