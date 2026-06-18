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

// Content-part types that carry the model's chain-of-thought rather than the
// answer text. They must be kept out of the visible answer and surfaced
// separately as reasoning.
const REASONING_PART_TYPES = new Set(["reasoning", "thinking"]);

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
      if (part && typeof part === "object") {
        // Reasoning parts carry their own `text`; skip them here so the model's
        // chain-of-thought never leaks into the visible answer.
        if ("type" in part && typeof part.type === "string" && REASONING_PART_TYPES.has(part.type)) {
          return "";
        }
        if ("text" in part && typeof part.text === "string") {
          return part.text;
        }
      }
      return "";
    })
    .join("");
};

/**
 * Extract the reasoning ("chain-of-thought") delta carried by an AI message
 * chunk, if any. Providers expose it in different shapes:
 *
 * - DeepSeek and OpenAI-compatible gateways put it in
 *   `additional_kwargs.reasoning_content` (a plain string) or
 *   `additional_kwargs.reasoning`.
 * - Some providers stream structured content parts of type `reasoning` /
 *   `thinking`, each carrying `text` (or `reasoning`).
 *
 * The returned string is the reasoning text for this chunk only; chunks stream
 * token by token, so callers concatenate the deltas as they arrive. Returns an
 * empty string when the chunk carries no reasoning.
 */
export const extractReasoningText = (content: MessageContent, additionalKwargs?: Record<string, unknown>): string => {
  let reasoning = "";

  if (additionalKwargs) {
    const raw = additionalKwargs.reasoning_content ?? additionalKwargs.reasoning;
    if (typeof raw === "string") {
      reasoning += raw;
    } else if (raw && typeof raw === "object" && "text" in raw && typeof (raw as { text: unknown }).text === "string") {
      reasoning += (raw as { text: string }).text;
    }
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && "type" in part && typeof part.type === "string") {
        if (!REASONING_PART_TYPES.has(part.type)) {
          continue;
        }
        if ("text" in part && typeof part.text === "string") {
          reasoning += part.text;
        } else if ("reasoning" in part && typeof (part as { reasoning: unknown }).reasoning === "string") {
          reasoning += (part as { reasoning: string }).reasoning;
        }
      }
    }
  }

  return reasoning;
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
