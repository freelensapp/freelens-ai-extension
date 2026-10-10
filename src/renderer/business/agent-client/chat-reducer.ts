import { generateUuid } from "../../../common/utils/uuid";
import { MessageType } from "../objects/message-type";

import type { AgentEnvelope } from "../../../common/agent-protocol";
import type { MessageObject } from "../objects/message-object";

/** What the chat of one cluster frame shows, rebuilt from main's envelopes. */
export interface ChatViewState {
  clusterId: string;
  /** The last envelope applied; older or repeated envelopes are ignored. */
  seq: number;
  messages: MessageObject[];
}

type EventPayload = Extract<AgentEnvelope, { kind: "event" }>["payload"];

const lastUserText = (messages: MessageObject[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.sent) return messages[i]!.text;
  }
  return "";
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
      return [
        ...messages,
        { messageId: generateUuid(), type: MessageType.MESSAGE, text: "", sent: false, streaming: true },
      ];

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
      const { stopReason, errorMessage } = event.message;
      if (stopReason !== "error") return closed;
      return [
        ...closed,
        {
          messageId: generateUuid(),
          type: MessageType.MESSAGE,
          text: `Error while running Freelens Agent: ${errorMessage ?? "unknown error"}`,
          error: true,
          retryContext: { kind: "message", text: lastUserText(closed) },
          sent: false,
        },
      ];
    }

    default:
      return messages;
  }
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
  const messages = envelope.kind === "event" ? reduceEvent(state.messages, envelope.payload) : state.messages;
  return { ...state, seq: envelope.seq, messages };
}

/** True when the envelope ends this cluster's run, so the chat can stop its spinner. */
export function isRunEnd(clusterId: string, envelope: AgentEnvelope): boolean {
  return envelope.clusterId === clusterId && envelope.kind === "event" && envelope.payload.type === "agent_settled";
}
