// The IPC protocol between the pi agent host in main and the cluster frames.
// Main broadcasts envelopes to every frame; each frame keeps only its own
// cluster's. Frames send commands to main and get a response back through the
// `invoke` promise. Shapes follow pi's RPC mode (`RpcCommand`, `RpcResponse`,
// `JsonAgentSessionEvent`) so events from pi reach the renderer unchanged.

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

export type AgentCommand =
  | { type: "prompt"; message: string }
  | { type: "tool_result"; requestId: string; text: string; isError?: boolean };

export type AgentResponse =
  | { type: "response"; command: string; success: true; data?: unknown }
  | { type: "response"; command: string; success: false; error: string };
