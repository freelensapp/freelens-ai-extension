import { MessageType } from "./message-type";

export type MessageObject = {
  type: MessageType;
  text: string;
  options?: string[];
  sent: boolean;
};
