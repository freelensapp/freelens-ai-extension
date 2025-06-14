import { Interrupt } from "@langchain/langgraph";
import { MessageType } from "./message-type";

export function getTextMessage(message: string, sent: boolean) {
  return {
    type: MessageType.MESSAGE,
    text: message,
    sent: sent,
  };
}

export function getExplainMessage(message: string) {
  return {
    type: MessageType.EXPLAIN,
    text: message,
    sent: true,
  };
}

export function getInterruptMessage(chunk: Interrupt, sent: boolean) {
  return {
    type: MessageType.INTERRUPT,
    text: chunk.value.requestString,
    options: chunk.value.options,
    sent: sent,
  };
}
