// The IPC protocol between the pi agent host in main and the cluster frames.
// Main broadcasts envelopes to every frame; each frame keeps only its own
// cluster's. Frames send commands to main and get a response back through the
// `invoke` promise. Shapes follow pi's RPC mode (`RpcCommand`, `RpcResponse`,
// `JsonAgentSessionEvent`) so events from pi reach the renderer unchanged.

import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

export const AGENT_COMMAND_CHANNEL = "agent:command";
export const AGENT_ENVELOPE_CHANNEL = "agent:envelope";

/** A tool call that main asks the cluster frame to run. */
export interface ToolRequest {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface EnvelopeBase {
  clusterId: string;
  sessionId: string;
  /** Increases by one for every envelope of a cluster. */
  seq: number;
}

export type AgentEnvelope =
  | (EnvelopeBase & { kind: "event"; payload: JsonAgentSessionEvent })
  | (EnvelopeBase & { kind: "tool_request"; payload: ToolRequest });

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
  /** Filled by the approval gate (ticket 05). */
  pendingUiRequest?: unknown;
  /** Filled by "Approve all in this chat" (ticket 07). */
  autoApprove: boolean;
  /** The last envelope main sent for this cluster. */
  seq: number;
}

export type AgentCommand =
  | { type: "prompt"; message: string }
  | { type: "abort" }
  | { type: "get_snapshot" }
  | { type: "tool_result"; requestId: string; text: string; isError?: boolean };

export type AgentResponse =
  | { type: "response"; command: string; success: true; data?: unknown }
  | { type: "response"; command: string; success: false; error: string };
