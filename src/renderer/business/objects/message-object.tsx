import { MessageType } from "./message-type";

export interface MessageObject {
  messageId: string;
  type: MessageType;
  text: string;
  // The model's reasoning ("chain-of-thought"), streamed before the answer and
  // rendered in a separate collapsible block. Absent for messages without it.
  reasoning?: string;
  question?: string;
  action?: string;
  options?: string[];
  approved?: boolean | null;
  sent: boolean;
}
