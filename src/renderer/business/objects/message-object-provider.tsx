import { MessageType } from "../../../common/objects/message-type";
import { generateUuid } from "../../../common/utils/uuid";

import type { ApprovalRequest } from "../../../common/bridge/protocol";
import type { MessageObject, RetryContext } from "../../../common/objects/message-object";

export function getTextMessage(message: string, sent: boolean): MessageObject {
  return {
    messageId: generateUuid(),
    type: MessageType.MESSAGE,
    text: message,
    sent: sent,
  };
}

// Error message shown after a failed agent run. A `retryContext` lets the chat
// offer a "Retry" button that re-runs the original query; without one, a retry
// could not succeed and the error offers none.
export function getErrorMessage(message: string, retryContext?: RetryContext): MessageObject {
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

export function getInterruptMessage(request: ApprovalRequest, sent: boolean): MessageObject {
  const { action } = request.actionToApprove;
  return {
    messageId: generateUuid(),
    type: MessageType.INTERRUPT,
    // The MCP agent names the tools it asks for as a list.
    action: Array.isArray(action) ? action.join(", ") : action,
    question: request.question,
    text: request.requestString,
    actionDetails: request.actionString,
    resources: request.resourcesString,
    options: request.options,
    approved: null,
    sent: sent,
  };
}
