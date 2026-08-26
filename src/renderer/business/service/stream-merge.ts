/**
 * Helpers for merging the AI message chunks streamed by the agent into a single
 * Markdown string without gluing distinct assistant messages onto one line.
 *
 * The agent streams in `messages` mode: a single assistant message arrives as
 * many chunks that must be concatenated directly (token streaming). When the
 * graph emits a *new* assistant message - typically the summary the model writes
 * after a tool call - concatenating it straight onto the previous one produces
 * output like `...check?### Summary`, where `###` is no longer at the start of a
 * line and Markdown renders it verbatim. A blank line at that boundary keeps the
 * heading in its own block.
 *
 * The boundary is taken from the LangGraph stream metadata (the second element
 * of every `messages` tuple) rather than from the chunk id. LangGraph tags each
 * chunk with the checkpoint namespace of the node execution that produced it
 * (`<node>:<taskId>`, minted once per node run), so it changes exactly once per
 * assistant message and is provider independent. The chunk id is not: OpenAI
 * repeats one completion id for a whole message, but a LiteLLM gateway proxying
 * Ollama mints a fresh id on every SSE chunk (and LangGraph only rewrites the
 * ids it generated itself), so treating any id change as a boundary inserted a
 * blank line between every token and rendered one word per Markdown paragraph.
 *
 * Without metadata the rule degrades to an id change that is additionally gated
 * on a finish signal already seen for the previous message, so per-chunk ids
 * still concatenate. `@langchain/openai` reports `finish_reason` in the
 * generation info, which is not merged into the chunk on the callback path
 * LangGraph streams through, so that fallback usually resolves to plain
 * concatenation - the safe direction, since a missing separator is a cosmetic
 * defect while a spurious one breaks every line of the answer.
 */

import type { MessageContent } from "@langchain/core/messages";

export interface StreamMergeState {
  lastMessageId: string | undefined;
  lastBoundaryKey: string | undefined;
  // Whether the provider already reported the current message as complete. Only
  // consulted by the id fallback, when no LangGraph metadata is available.
  finished: boolean;
  started: boolean;
}

/**
 * The parts of a streamed `AIMessageChunk` this module reads. Declared
 * structurally so the helpers stay free of any LangChain runtime dependency.
 */
export interface AiMessageChunk {
  id?: string;
  content: MessageContent;
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
}

// Content-part types that carry the model's chain-of-thought rather than the
// answer text. They must be kept out of the visible answer and surfaced
// separately as reasoning.
const REASONING_PART_TYPES = new Set(["reasoning", "thinking"]);

export const createStreamMergeState = (): StreamMergeState => ({
  lastMessageId: undefined,
  lastBoundaryKey: undefined,
  finished: false,
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
 * Identify the graph node execution a streamed chunk belongs to, from the
 * LangGraph metadata carried alongside it. The checkpoint namespace is
 * `<node>:<taskId>` with the task id derived from the superstep, so it is minted
 * once per node run and is the same for every token of one assistant message.
 * Falls back to node plus step, and returns undefined when the metadata carries
 * neither (callers then use the id fallback).
 */
export const streamBoundaryKey = (metadata: Record<string, unknown> | undefined): string | undefined => {
  if (!metadata) {
    return undefined;
  }

  const checkpointNamespace = metadata.langgraph_checkpoint_ns ?? metadata.checkpoint_ns;
  if (typeof checkpointNamespace === "string" && checkpointNamespace.length > 0) {
    return checkpointNamespace;
  }

  const node = metadata.langgraph_node;
  if (typeof node !== "string" || node.length === 0) {
    return undefined;
  }

  const step = metadata.langgraph_step;
  return typeof step === "number" ? `${node}:${step}` : node;
};

/**
 * Whether a chunk reports the message it belongs to as complete. Providers put
 * the OpenAI `finish_reason` either on `response_metadata` or on
 * `additional_kwargs`; an explicit null (sent on every intermediate chunk) means
 * "not finished" and is ignored.
 */
export const hasFinishSignal = (chunk: AiMessageChunk): boolean => {
  for (const source of [chunk.response_metadata, chunk.additional_kwargs]) {
    const reason = source?.finish_reason;
    if (typeof reason === "string" && reason.length > 0) {
      return true;
    }
  }

  return false;
};

const isMessageBoundary = (
  state: StreamMergeState,
  chunk: AiMessageChunk,
  boundaryKey: string | undefined,
): boolean => {
  if (!state.started) {
    return false;
  }

  if (boundaryKey !== undefined && state.lastBoundaryKey !== undefined) {
    return boundaryKey !== state.lastBoundaryKey;
  }

  // No metadata to compare: an id change alone is not evidence of a new message,
  // because some gateways mint one id per streamed chunk. Require the previous
  // message to have been reported as finished as well.
  return state.finished && chunk.id !== undefined && chunk.id !== state.lastMessageId;
};

/**
 * Returns the text to yield for an incoming AI message chunk, updating `state`.
 *
 * Empty chunks yield nothing. When a new assistant message begins a blank-line
 * separator is prepended so the following content starts a fresh Markdown block;
 * every other chunk is concatenated directly to preserve token streaming. See
 * the module doc comment for how the boundary is detected.
 *
 * `metadata` is the second element of the `messages` stream tuple. `content` may
 * be a plain string or LangChain's structured content array; it is flattened to
 * text first, so a chunk that also carries `tool_call_chunks` still contributes
 * its preamble text instead of being dropped.
 */
export const mergeAiChunk = (
  state: StreamMergeState,
  chunk: AiMessageChunk,
  metadata?: Record<string, unknown>,
): string => {
  // Recorded before the empty-chunk exit below: OpenAI-compatible endpoints
  // report `finish_reason` on a final chunk whose content delta is empty.
  if (hasFinishSignal(chunk)) {
    state.finished = true;
  }

  const text = flattenContentText(chunk.content);
  if (text.length === 0) {
    return "";
  }

  const boundaryKey = streamBoundaryKey(metadata);
  const isNewMessage = isMessageBoundary(state, chunk, boundaryKey);

  state.lastMessageId = chunk.id;
  state.lastBoundaryKey = boundaryKey;
  state.started = true;
  if (isNewMessage) {
    state.finished = false;
  }

  return isNewMessage ? `\n\n${text}` : text;
};
