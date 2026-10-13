import { MessageType } from "./message-type";

// Describes how to re-run a query that failed, so an error message can offer a
// "Retry" button. Kept to plain serializable fields because message objects are
// persisted to localStorage as JSON.
//   - "message": a normal user prompt -> re-run the agent with the same text.
//   - "resume":  an approval answer ("yes"/"no") to a tool-use interrupt.
//   - "explain": an EXPLAIN request analyzed by the AI analysis service.
export interface RetryContext {
  kind: "message" | "resume" | "explain";
  text: string;
}

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
  // Marks an agent error message that should render a "Retry" button. The
  // `retryContext` carries everything needed to re-run the failed query.
  error?: boolean;
  retryContext?: RetryContext;
  sent: boolean;
}
