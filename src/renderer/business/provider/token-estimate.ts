// Local, network-free token estimation.
//
// Used as a fallback for the capacity indicator when the provider reports no
// token usage, and to size the context right after a compaction. The counts are
// advisory only (no trimming, no `maxTokens` budgeting), so the common
// ~4-chars-per-token heuristic is enough and needs no tokenizer download.

// Message content: a plain string, or an array of content blocks. Blocks are
// described structurally so both Strands blocks (`TextBlock`, `ToolUseBlock`,
// `ToolResultBlock`) and plain OpenAI-style parts are accepted.
export type MessageContent = string | readonly unknown[];

const blockToText = (block: unknown): string => {
  if (typeof block !== "object" || block === null) {
    return "";
  }
  const { type, text, input, content } = block as {
    type?: unknown;
    text?: unknown;
    input?: unknown;
    content?: unknown;
  };
  if (typeof text === "string" && (type === "text" || type === "textBlock")) {
    return text;
  }
  // Tool calls and tool results are re-sent with every prompt, so they count.
  if (type === "toolUseBlock" && input !== undefined) {
    return JSON.stringify(input);
  }
  if (type === "toolResultBlock" && Array.isArray(content)) {
    return content
      .map((item) =>
        typeof (item as { text?: unknown })?.text === "string"
          ? (item as { text: string }).text
          : (item as { json?: unknown })?.json !== undefined
            ? JSON.stringify((item as { json: unknown }).json)
            : "",
      )
      .join("");
  }
  return "";
};

/**
 * Flatten message content (a plain string or an array of content blocks) into
 * the text we count. Non-text blocks (images, files) contribute no text.
 */
export const messageContentToText = (content: MessageContent): string => {
  if (typeof content === "string") {
    return content;
  }
  return content.map(blockToText).join("");
};

/**
 * Approximate the token count of some message content using the common
 * heuristic of roughly four characters per token.
 */
export const approximateTokenCount = (content: MessageContent): number =>
  Math.ceil(messageContentToText(content).length / 4);

/**
 * Approximate the token count of the conversation carried into the next prompt
 * by summing the per-message estimate. Omits the fixed system-prompt and
 * tool-schema overhead, so it slightly under-counts the real prompt; the 90%
 * compaction threshold leaves headroom.
 */
export const approximateMessagesTokenCount = (messages: { content: MessageContent }[] | undefined): number =>
  (messages ?? []).reduce((sum, message) => sum + approximateTokenCount(message.content), 0);
