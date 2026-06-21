// Local, network-free token estimation.
//
// `@langchain/core`'s default `getNumTokens` lazily downloads the tiktoken BPE
// ranks from `https://tiktoken.pages.dev` on the first call. When that host is
// unreachable (corporate proxy, air-gapped cluster) the fetch fails, retries
// with exponential backoff, and is never cached — so every model turn re-stalls
// for minutes and the chat appears to hang. See issue #181.
//
// The extension never uses these counts for anything functional (no trimming,
// no `maxTokens` budgeting — they only populate advisory token-usage metadata),
// so we approximate locally with the same ~4-chars-per-token rule LangChain
// itself falls back to once the download fails, but without the network round
// trip and retry stall.

import type { MessageContent } from "@langchain/core/messages";

/**
 * Flatten a `MessageContent` (a plain string or an array of content blocks)
 * into the text we count. Non-text blocks (images, files) contribute no text.
 */
export const messageContentToText = (content: MessageContent): string => {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((item) => (typeof item === "object" && item !== null && item.type === "text" ? (item.text ?? "") : ""))
    .join("");
};

/**
 * Approximate the token count of some message content using the common
 * heuristic of roughly four characters per token.
 */
export const approximateTokenCount = (content: MessageContent): number =>
  Math.ceil(messageContentToText(content).length / 4);
