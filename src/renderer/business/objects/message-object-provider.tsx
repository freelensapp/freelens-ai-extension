import { MessageType } from "../../../common/objects/message-type";
import { generateUuid } from "../../../common/utils/uuid";

import type { MessageObject, RetryContext } from "../../../common/objects/message-object";

export function getTextMessage(message: string, sent: boolean): MessageObject {
  return {
    messageId: generateUuid(),
    type: MessageType.MESSAGE,
    text: message,
    sent: sent,
  };
}

// Error message shown after a failed agent run. It carries a `retryContext` so
// the chat can offer a "Retry" button that re-runs the original query.
export function getErrorMessage(message: string, retryContext: RetryContext): MessageObject {
  return {
    messageId: generateUuid(),
    type: MessageType.MESSAGE,
    text: message,
    error: true,
    retryContext,
    sent: false,
  };
}

export function getExplainMessage(message: string): MessageObject {
  return {
    messageId: generateUuid(),
    type: MessageType.EXPLAIN,
    text: message,
    sent: true,
  };
}
