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
  // The action payload rendered as YAML, shown in the approval prompt under a
  // foldable "Action details" section. Absent for non-structured interrupts.
  actionDetails?: string;
  // The current full YAML of the resource(s) the action will change, shown as a
  // folded "Resources that will be changed" backup so the change can be undone.
  resources?: string;
  options?: string[];
  approved?: boolean | null;
  sent: boolean;
}
