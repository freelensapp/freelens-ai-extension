import { Interrupt } from "@langchain/langgraph";
import { generateUuid } from "../../../common/utils/uuid";
import { MessageType } from "./message-type";

import type { MessageObject } from "./message-object";

export function getTextMessage(message: string, sent: boolean): MessageObject {
  return {
    messageId: generateUuid(),
    type: MessageType.MESSAGE,
    text: message,
    sent: sent,
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

export function getInterruptMessage(chunk: Interrupt, sent: boolean): MessageObject {
  return {
    messageId: generateUuid(),
    type: MessageType.INTERRUPT,
    action: chunk.value.actionToApprove.action,
    question: chunk.value.question,
    text: chunk.value.requestString,
    actionDetails: chunk.value.actionString,
    resources: chunk.value.resourcesString,
    options: chunk.value.options,
    approved: null,
    sent: sent,
  };
}
