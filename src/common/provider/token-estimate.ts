// Local, network-free token estimation.
//
// The extension never needs an exact count: the estimates size the capacity
// indicator and the compaction decision, which the real usage of every model
// call corrects. So it approximates with the common rule of roughly four
// characters per token, without a tokenizer and without any download.

/**
 * The content of a message: a plain string, or an array of content parts of
 * which the text parts are counted. Shaped after the content of a model
 * message, without depending on a model library, so that both processes can
 * use these helpers.
 */
export type MessageContent = string | ReadonlyArray<{ type: string; text?: unknown }>;

/**
 * Flatten a `MessageContent` (a plain string or an array of content parts) into
 * the text we count. Non-text parts (images, files) contribute no text.
 */
export const messageContentToText = (content: MessageContent): string => {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((item) =>
      typeof item === "object" && item !== null && item.type === "text" && typeof item.text === "string"
        ? item.text
        : "",
    )
    .join("");
};

/**
 * Approximate the token count of some message content using the common
 * heuristic of roughly four characters per token.
 */
export const approximateTokenCount = (content: MessageContent): number =>
  Math.ceil(messageContentToText(content).length / 4);

/**
 * Approximate the token count of the persisted conversation carried into the
 * next prompt by summing the per-message estimate. Omits the fixed
 * system-prompt and tool-schema overhead, which the agent measures per call and
 * adds itself.
 */
export const approximateMessagesTokenCount = (messages: { content: MessageContent }[] | undefined): number =>
  (messages ?? []).reduce((sum, message) => sum + approximateTokenCount(message.content), 0);
