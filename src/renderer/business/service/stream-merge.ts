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
 * Read a `reasoning_content` / `reasoning` value out of a single metadata
 * record (e.g. `additional_kwargs`, `response_metadata`, or the message object
 * itself). The value is either a plain string or an object carrying `text`.
 * Returns an empty string when the record has no reasoning.
 */
const extractReasoningFromMetadata = (source: Record<string, unknown> | undefined): string => {
  if (!source) {
    return "";
  }

  const raw = source.reasoning_content ?? source.reasoning;
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw === "object" && "text" in raw && typeof (raw as { text: unknown }).text === "string") {
    return (raw as { text: string }).text;
  }

  return "";
};

/**
 * Extract the reasoning ("chain-of-thought") delta carried by an AI message
 * chunk, if any. Providers expose it in different shapes:
 *
 * - DeepSeek and OpenAI-compatible gateways put it in
 *   `additional_kwargs.reasoning_content` (a plain string) or
 *   `additional_kwargs.reasoning`. Some gateways instead surface it under
 *   `response_metadata`, or as a `reasoning_content` field sitting directly on
 *   the message object next to `content`. All of these are passed in as
 *   `metadataSources` and checked in order; the first one carrying reasoning
 *   wins (so the same delta is never counted twice).
 * - Some providers stream structured content parts of type `reasoning` /
 *   `thinking`, each carrying `text` (or `reasoning`).
 *
 * The returned string is the reasoning text for this chunk only; chunks stream
 * token by token, so callers concatenate the deltas as they arrive. Returns an
 * empty string when the chunk carries no reasoning.
 */
export const extractReasoningText = (
  content: MessageContent,
  ...metadataSources: (Record<string, unknown> | undefined)[]
): string => {
  let reasoning = "";

  for (const source of metadataSources) {
    const fromMetadata = extractReasoningFromMetadata(source);
    if (fromMetadata) {
      reasoning += fromMetadata;
      break;
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
        } else if ("reasoning" in part && typeof (part as { reasoning?: unknown }).reasoning === "string") {
          reasoning += (part as { reasoning?: string }).reasoning;
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
