import { MessageType } from "./message-type";

// Describes how to re-run a query that failed, so an error message can offer a
// "Retry" button.
//   - "message": a normal user prompt -> send the same prompt again.
//   - "explain": an AI Explain request -> run the explanation again.
export interface RetryContext {
  kind: "message" | "explain";
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
  // Main loads it before asking and sends it with the approval request.
  resources?: string;
  options?: string[];
  approved?: boolean | null;
  // Set on a pi agent approval card: the id main answers with `ui_response`.
  approvalId?: string;
  // Marks an agent error message that should render a "Retry" button. The
  // `retryContext` carries everything needed to re-run the failed query.
  error?: boolean;
  retryContext?: RetryContext;
  // Set while the pi agent is still streaming this message.
  streaming?: boolean;
  // A status line from the agent run (stopped, retrying), not an answer.
  notice?: boolean;
  sent: boolean;
}
