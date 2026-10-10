import type { AgentSessionEvent, JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

type MessageUpdateEvent = Extract<AgentSessionEvent, { type: "message_update" }>;
type JsonMessageUpdateEvent = Extract<JsonAgentSessionEvent, { type: "message_update" }>;

// Our copy of pi's `toJsonEvent()` from `modes/json-event.js`, which pi does not
// export. In-process, every streaming delta carries the whole partial message
// so far; the wire form drops that copy and keeps only the delta, so the IPC
// traffic stays small. `message_start` and `message_end` carry the message.
function toJsonAssistantMessageEvent(
  event: MessageUpdateEvent["assistantMessageEvent"],
): JsonMessageUpdateEvent["assistantMessageEvent"] {
  if (event.type === "toolcall_start") {
    const toolCall = event.partial.content[event.contentIndex];
    const { partial: _partial, ...deltaEvent } = event;
    return {
      ...deltaEvent,
      id: toolCall?.type === "toolCall" ? toolCall.id : "",
      toolName: toolCall?.type === "toolCall" ? toolCall.name : "",
    };
  }
  if (!("partial" in event)) {
    return event;
  }
  const { partial: _partial, ...deltaEvent } = event;
  return deltaEvent as JsonMessageUpdateEvent["assistantMessageEvent"];
}

export function toJsonEvent(event: AgentSessionEvent): JsonAgentSessionEvent {
  if (event.type !== "message_update") {
    return event;
  }
  return {
    type: "message_update",
    usage: event.message.role === "assistant" ? event.message.usage : undefined,
    assistantMessageEvent: toJsonAssistantMessageEvent(event.assistantMessageEvent),
  } as JsonMessageUpdateEvent;
}
