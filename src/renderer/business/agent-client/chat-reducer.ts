import { generateUuid } from "../../../common/utils/uuid";
import { MessageType } from "../objects/message-type";

import type { AgentEnvelope, AgentSnapshot, ApprovalRequest, ChatMessage } from "../../../common/agent-protocol";
import type { MessageObject } from "../objects/message-object";

/** What the chat of one cluster frame shows, rebuilt from main's snapshot and envelopes. */
export interface ChatViewState {
  clusterId: string;
  /** The last envelope applied; older or repeated envelopes are ignored. */
  seq: number;
  messages: MessageObject[];
  /** True from the run's start until it settles: the input is disabled and Stop is shown. */
  isRunning: boolean;
  /** Set when envelopes were missed; the frame then asks main for a fresh snapshot. */
  stale?: boolean;
}

type EventPayload = Extract<AgentEnvelope, { kind: "event" }>["payload"];
type AssistantChatMessage = Extract<ChatMessage, { role: "assistant" }>;

const lastUserText = (messages: MessageObject[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.sent) return messages[i]!.text;
  }
  return "";
};

const textMessage = (text: string, extra: Partial<MessageObject> = {}): MessageObject => ({
  messageId: generateUuid(),
  type: MessageType.MESSAGE,
  text,
  sent: false,
  ...extra,
});

const notice = (text: string) => textMessage(text, { notice: true });

const errorMessage = (error: string | undefined, messages: MessageObject[]) =>
  textMessage(`Error while running Freelens Agent: ${error ?? "unknown error"}`, {
    error: true,
    retryContext: { kind: "message", text: lastUserText(messages) },
  });

// The lines that follow an assistant message that did not end normally.
const endLines = (message: AssistantChatMessage, messages: MessageObject[]): MessageObject[] => {
  if (message.stopReason === "error") return [errorMessage(message.errorMessage, messages)];
  if (message.stopReason === "aborted") return [notice("Stopped.")];
  return [];
};

// The message being streamed is the last one while it carries `streaming`.
const updateStreaming = (messages: MessageObject[], update: (message: MessageObject) => MessageObject) => {
  const last = messages[messages.length - 1];
  if (!last?.streaming) return messages;
  return [...messages.slice(0, -1), update(last)];
};

function reduceEvent(messages: MessageObject[], event: EventPayload): MessageObject[] {
  switch (event.type) {
    case "message_start":
      if (event.message.role !== "assistant") return messages;
      return [...messages, textMessage("", { streaming: true })];

    case "message_update": {
      const delta = event.assistantMessageEvent;
      if (delta.type === "text_delta") {
        return updateStreaming(messages, (m) => ({ ...m, text: m.text + delta.delta }));
      }
      if (delta.type === "thinking_delta") {
        return updateStreaming(messages, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + delta.delta }));
      }
      return messages;
    }

    case "message_end": {
      if (event.message.role !== "assistant") return messages;
      const last = messages[messages.length - 1];
      // A turn with only tool calls streams no text: drop its empty bubble.
      const closed = last?.streaming
        ? last.text || last.reasoning
          ? [...messages.slice(0, -1), { ...last, streaming: false }]
          : messages.slice(0, -1)
        : messages;
      return [...closed, ...endLines(event.message, closed)];
    }

    // pi retries the failed request on its own, so the error it just showed
    // becomes a notice without a Retry button.
    case "auto_retry_start": {
      const last = messages[messages.length - 1];
      const kept = last?.error ? messages.slice(0, -1) : messages;
      const seconds = Math.round(event.delayMs / 1000);
      return [
        ...kept,
        notice(
          `Provider error: ${event.errorMessage}. Retrying in ${seconds} s (attempt ${event.attempt} of ${event.maxAttempts}).`,
        ),
      ];
    }

    default:
      return messages;
  }
}

const isRunningAfter = (isRunning: boolean, envelope: AgentEnvelope) => {
  if (envelope.kind !== "event") return isRunning;
  if (envelope.payload.type === "agent_start") return true;
  if (envelope.payload.type === "agent_settled") return false;
  return isRunning;
};

const approvalCard = (request: ApprovalRequest): MessageObject => ({
  messageId: generateUuid(),
  type: MessageType.INTERRUPT,
  action: request.title,
  question: "Do you want to approve this action?",
  text: `\`\`\`yaml\n${request.message}\`\`\``,
  actionDetails: request.message,
  options: ["yes", "no"],
  approved: null,
  approvalId: request.id,
  approvalTarget: request.approval,
  sent: false,
});

const updateApproval = (messages: MessageObject[], id: string, update: Partial<MessageObject>) => {
  const index = messages.findIndex((message) => message.approvalId === id);
  if (index < 0) return messages;
  return [...messages.slice(0, index), { ...messages[index]!, ...update }, ...messages.slice(index + 1)];
};

function reduceMessages(messages: MessageObject[], envelope: AgentEnvelope): MessageObject[] {
  switch (envelope.kind) {
    case "event":
      return reduceEvent(messages, envelope.payload);
    case "ui_request":
      return messages.some((message) => message.approvalId === envelope.payload.id)
        ? messages
        : [...messages, approvalCard(envelope.payload)];
    case "ui_resolved":
      return updateApproval(messages, envelope.payload.id, { approved: envelope.payload.confirmed });
    default:
      return messages;
  }
}

/** Shows the current YAML of the resource an approval would change, once the frame has loaded it. */
export function withApprovalBackup(state: ChatViewState, approvalId: string, yaml: string): ChatViewState {
  const messages = updateApproval(state.messages, approvalId, { resources: yaml });
  return messages === state.messages ? state : { ...state, messages };
}

/**
 * Applies one envelope from main to the chat. Envelopes for other clusters and
 * envelopes already applied leave the state untouched. Seq 1 always applies:
 * main counts from 1 again after the extension restarts.
 */
export function reduceEnvelope(state: ChatViewState, envelope: AgentEnvelope): ChatViewState {
  if (envelope.clusterId !== state.clusterId || (envelope.seq <= state.seq && envelope.seq !== 1)) {
    return state;
  }
  const missed = envelope.seq !== 1 && envelope.seq > state.seq + 1;
  const messages = reduceMessages(state.messages, envelope);
  return {
    ...state,
    seq: envelope.seq,
    messages,
    isRunning: isRunningAfter(state.isRunning, envelope),
    stale: state.stale || missed || undefined,
  };
}

const userText = (message: Extract<ChatMessage, { role: "user" }>) =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");

const assistantMessage = (message: AssistantChatMessage, streaming: boolean): MessageObject | undefined => {
  const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  const reasoning = message.content.map((part) => (part.type === "thinking" ? part.thinking : "")).join("");
  // An answer still streaming keeps its bubble even when empty, so its deltas
  // have somewhere to go.
  if (!text && !reasoning && !streaming) return undefined;
  return textMessage(text, { reasoning: reasoning || undefined, streaming: streaming || undefined });
};

/**
 * Rebuilds a cluster's chat from main's snapshot: on mount, after a restart and
 * after missed envelopes. Envelopes up to the snapshot's `seq` are already in it.
 */
export function chatFromSnapshot(clusterId: string, snapshot: AgentSnapshot): ChatViewState {
  let messages: MessageObject[] = [];
  for (const message of snapshot.messages) {
    if (message.role === "user") {
      messages = [...messages, textMessage(userText(message), { sent: true })];
      continue;
    }
    const answer = assistantMessage(message, false);
    messages = [...messages, ...(answer ? [answer] : []), ...endLines(message, messages)];
  }
  const streaming = snapshot.streamingMessage && assistantMessage(snapshot.streamingMessage, true);
  if (streaming) messages = [...messages, streaming];
  if (snapshot.pendingUiRequest) messages = [...messages, approvalCard(snapshot.pendingUiRequest)];
  return { clusterId, seq: snapshot.seq, messages, isRunning: snapshot.isStreaming };
}
