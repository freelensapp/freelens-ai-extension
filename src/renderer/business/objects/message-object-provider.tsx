import { generateUuid } from "../../../common/utils/uuid";
import { MessageType } from "./message-type";

import type { ApprovalRequest } from "../agent/tools/approval";
import type { MessageObject, RetryContext } from "./message-object";

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

export function getInterruptMessage(approval: ApprovalRequest, sent: boolean): MessageObject {
  return {
    messageId: generateUuid(),
    type: MessageType.INTERRUPT,
    action: String(approval.actionToApprove.action),
    question: approval.question,
    text: approval.requestString,
    actionDetails: approval.actionString,
    resources: approval.resourcesString,
    options: approval.options,
    approved: null,
    sent: sent,
  };
}
