// Pure helpers for deciding when a chat session must be compacted and for
// building the summarization prompt used to compact it.
//
// Kept free of host/MobX/network/LangChain-runtime dependencies so the decision
// math and prompt assembly can be unit-tested in isolation (see
// session-compaction.test.ts). The impure parts - reading the model-side
// history, invoking the model to summarize, and wiping the LangGraph thread -
// live in session-compaction-service.ts and application-context.tsx.

import { messageContentToText } from "../provider/token-estimate";

import type { MessageContent } from "@langchain/core/messages";

import type { ModelPricing } from "../provider/model-pricing";

// Fallback context window used when the selected model's max input tokens are
// unknown (an undetected model, or pricing data that did not load). A
// conservative 128k matches the smallest common large-context window, so the
// estimate stays pessimistic rather than letting an unknown model run until the
// endpoint rejects the request.
export const DEFAULT_MAX_INPUT_TOKENS = 128_000;

// Compact once the estimated next prompt reaches this fraction of the model's
// max input tokens, leaving headroom for the model's own response and for the
// imprecision of the naive token estimate.
export const COMPACTION_THRESHOLD = 0.9;

/**
 * Resolve the model's max input tokens from the pricing data already fetched for
 * the cost estimate (LiteLLM `/model/info` or the public price list). Falls back
 * to {@link DEFAULT_MAX_INPUT_TOKENS} when the model is unknown or advertises no
 * positive limit.
 */
export const resolveMaxInputTokens = (
  pricing: Pick<ModelPricing, "maxInputTokens"> | undefined,
  fallback: number = DEFAULT_MAX_INPUT_TOKENS,
): number => {
  const limit = pricing?.maxInputTokens;
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : fallback;
};

/**
 * Naively (pessimistically) estimate the next prompt's input token count from
 * the previous response's input tokens and the new message's estimated tokens.
 * The previous prompt's tokens are reused as the carried-over context size
 * because the model re-sends the accumulated conversation each turn.
 */
export const estimateNextPromptTokens = (lastInputTokens: number, nextMessageTokens: number): number =>
  Math.max(0, lastInputTokens) + Math.max(0, nextMessageTokens);

/**
 * Decide whether the session should be compacted before the next prompt: true
 * when the estimated prompt reaches {@link COMPACTION_THRESHOLD} of the model's
 * max input tokens. A zero/negative estimate never triggers compaction so a
 * fresh session (no prior response yet) is left alone.
 */
export const shouldCompactSession = (
  estimatedPromptTokens: number,
  maxInputTokens: number,
  threshold: number = COMPACTION_THRESHOLD,
): boolean => estimatedPromptTokens > 0 && maxInputTokens > 0 && estimatedPromptTokens >= maxInputTokens * threshold;

// One turn of the conversation, flattened to plain text for summarization.
export interface SummarizableMessage {
  role: string;
  content: string;
}

// Minimal shape of the LangChain messages held in the agent's LangGraph state.
// Only the fields read to render the conversation are described.
export interface HistoryMessageLike {
  getType?: () => string;
  content: MessageContent;
}

/**
 * Flatten the agent's stored history into role-tagged plain-text turns. Unknown
 * or missing types degrade to "message" so nothing is dropped.
 */
export const toSummarizableMessages = (messages: HistoryMessageLike[]): SummarizableMessage[] =>
  messages.map((message) => ({
    role: typeof message.getType === "function" ? message.getType() : "message",
    content: messageContentToText(message.content),
  }));

// Instruction prepended to the conversation when asking the model to compact it.
// The summary replaces the model-side history, so it must preserve the facts a
// follow-up turn needs (resources touched, findings, decisions, open actions).
export const COMPACTION_SUMMARY_INSTRUCTION = [
  "You are compacting a long Kubernetes assistant conversation so it fits within the model's context window.",
  "Write a concise summary that preserves every fact a follow-up turn may need:",
  "the user's goals, the cluster resources and namespaces discussed, findings and",
  "diagnoses, actions already taken or approved, and any still-open questions or",
  "next steps. Omit pleasantries and redundant detail. Respond with the summary only.",
].join(" ");

/**
 * Render the model-side history as the plain text fed to the summarizer. Empty
 * messages are dropped so they do not pad the prompt.
 */
export const renderConversationForSummary = (messages: SummarizableMessage[]): string =>
  messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");

/**
 * Build the full summarization prompt (instruction + rendered conversation).
 */
export const buildSummaryPrompt = (messages: SummarizableMessage[]): string =>
  `${COMPACTION_SUMMARY_INSTRUCTION}\n\n<conversation>\n${renderConversationForSummary(messages)}\n</conversation>`;
