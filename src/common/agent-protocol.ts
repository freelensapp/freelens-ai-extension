// The IPC protocol between the pi agent host in main and the cluster frames.
// Main broadcasts envelopes to every frame; each frame keeps only its own
// cluster's. Frames send commands to main and get a response back through the
// `invoke` promise. Shapes follow pi's RPC mode (`RpcCommand`, `RpcResponse`,
// `JsonAgentSessionEvent`) so events from pi reach the renderer unchanged.

import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

export const AGENT_COMMAND_CHANNEL = "agent:command";
export const AGENT_ENVELOPE_CHANNEL = "agent:envelope";

/** Chats not changed for this many days are deleted unless the user sets otherwise; 0 keeps them forever. */
export const DEFAULT_CHAT_RETENTION_DAYS = 30;

/** A tool call that main asks the cluster frame to run. */
export interface ToolRequest {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** What an approval is about; the frame uses it to load the current resource as a backup. */
export interface ApprovalTarget {
  tool: string;
  kind?: string;
  apiVersion?: string;
  name?: string;
  namespace?: string;
}

/**
 * Main asks the user to approve a tool call: pi's `confirm` UI request, with
 * the action as YAML in `message` and the target the frame needs for the card.
 */
export interface ApprovalRequest {
  id: string;
  toolCallId: string;
  method: "confirm";
  title: string;
  message: string;
  approval: ApprovalTarget;
}

/** An approval was answered, or denied by Stop. */
export interface ApprovalResolution {
  id: string;
  confirmed: boolean;
}

interface EnvelopeBase {
  clusterId: string;
  sessionId: string;
  /** Increases by one for every envelope of a cluster. */
  seq: number;
}

export type AgentEnvelope =
  | (EnvelopeBase & { kind: "event"; payload: JsonAgentSessionEvent })
  | (EnvelopeBase & { kind: "tool_request"; payload: ToolRequest })
  | (EnvelopeBase & { kind: "ui_request"; payload: ApprovalRequest })
  | (EnvelopeBase & { kind: "ui_resolved"; payload: ApprovalResolution })
  /** "Approve all in this chat" was turned on or off. */
  | (EnvelopeBase & { kind: "auto_approve"; payload: { enabled: boolean } });

/** A message of the chat transcript as main sends it in a snapshot. */
export type ChatMessage = UserMessage | AssistantMessage;

/**
 * Everything a frame needs to show a cluster's chat when it opens or remounts,
 * even mid-run. The frame then applies only envelopes with a higher `seq`.
 */
export interface AgentSnapshot {
  sessionId?: string;
  /** The saved user and assistant messages of the active session. */
  messages: ChatMessage[];
  /** The assistant answer being streamed right now, if any. */
  streamingMessage?: AssistantMessage;
  isStreaming: boolean;
  /** Tool calls main is still waiting on; a remounted frame answers them. */
  pendingToolRequests: ToolRequest[];
  /** The approval main is waiting on; the card comes back on remount. */
  pendingUiRequest?: ApprovalRequest;
  /** "Approve all in this chat" is on: gated calls run without asking. */
  autoApprove: boolean;
  /** The last envelope main sent for this cluster. */
  seq: number;
}

export type AgentCommand =
  | { type: "prompt"; message: string }
  | { type: "abort" }
  | { type: "get_snapshot" }
  /** Stops a run, then starts a new chat; answers with the new chat's snapshot. */
  | { type: "new_session" }
  /** Stops a run, deletes every chat of the cluster and starts a new one; answers with its snapshot. */
  | { type: "delete_sessions" }
  | { type: "tool_result"; requestId: string; text: string; isError?: boolean }
  /** `approveAll` with `confirmed` also stops asking for the rest of the chat. */
  | { type: "ui_response"; id: string; confirmed: boolean; approveAll?: boolean }
  /** Turns "Approve all in this chat" off; only an approval answer turns it on. */
  | { type: "set_auto_approve"; enabled: false };

export type AgentResponse =
  | { type: "response"; command: string; success: true; data?: unknown }
  | { type: "response"; command: string; success: false; error: string };
