// The protocol of the local HTTP bridge between the renderer and the agents in
// main. Main serves it on 127.0.0.1 (src/main/bridge/server.ts) and writes the
// port and a per-launch token into PreferencesStore; the renderer reads both
// for every request (src/renderer/business/bridge/bridge-client.ts), so a
// reload of the extension, which starts a new bridge, needs no page reload.
//
// Every body is plain JSON. A run is the response to the request that started
// it: an SSE stream of the events below, ended by `done` or `error`, or by
// `cancelled` when the bridge closes first. Closing the request cancels the run.

import type { ModelPricingMap } from "../provider/model-pricing";
import type { TokenUsage } from "../service/token-usage";

export const BRIDGE_HOST = "127.0.0.1";

// Carries the per-launch token. A request without it is refused with 401, so
// another local process that learns the port cannot use the user's API key.
export const BRIDGE_TOKEN_HEADER = "x-freelens-ai-token";

export const BridgeRoute = {
  // POST AgentRunRequest -> SSE of AgentRunEvent
  run: "/agent/run",
  // POST ExplainRequest -> SSE of ExplainEvent
  explain: "/agent/explain",
  // POST ConversationRequest -> CompactResponse
  compact: "/agent/compact",
  // POST ConversationRequest -> {}
  clear: "/agent/clear",
  // GET ?clusterId= -> ToolsResponse
  tools: "/agent/tools",
  // GET -> ModelPricingMap
  modelPricing: "/model/pricing",
} as const;

export type BridgeRoutePath = (typeof BridgeRoute)[keyof typeof BridgeRoute];

// The chat's cluster and conversation; every agent request names both, so two
// cluster frames never share a run or a memory.
export interface ConversationRequest {
  clusterId: string;
  conversationId: string;
}

export type AgentRunInput =
  // A prompt typed by the user. `summary` seeds a just compacted session.
  | { kind: "message"; text: string; summary?: string | null }
  // The answer picked for a pending approval ("yes" or "no").
  | { kind: "resume"; answer: string };

export interface AgentRunRequest extends ConversationRequest {
  input: AgentRunInput;
}

export interface ExplainRequest {
  clusterId: string;
  text: string;
}

export interface CompactResponse {
  // The summary to seed into the next prompt, or null when nothing was
  // summarized.
  summary: string | null;
  // The size of the compacted context, which replaces the last reading.
  contextTokens: number;
}

export interface ToolDescription {
  name: string;
  description: string;
}

export interface ToolsResponse {
  tools: ToolDescription[];
}

export type ModelPricingResponse = ModelPricingMap;

// What an approval interrupt carries; the renderer renders it and answers with
// a `resume` run.
export interface ApprovalRequest {
  question: string;
  options: string[];
  actionToApprove: { action: string | string[]; [key: string]: unknown };
  // Markdown fallback of the action.
  requestString: string;
  // The action as YAML, shown under "Action details".
  actionString?: string;
  // The current YAML of the resources the action changes, shown as a backup.
  resourcesString?: string;
}

export interface BridgeError {
  message: string;
}

// The last event of a stream that the bridge closed before it ended, because
// the extension stopped or reloaded in main. It comes in place of `done`: the
// work behind the stream is cancelled, and the connection closes after it.
export interface BridgeCancelledEvent {
  type: "cancelled";
}

export type AgentRunEvent =
  // Answer text, in the order it is generated.
  | { type: "text"; text: string }
  // The model's reasoning, shown apart from the answer.
  | { type: "reasoning"; reasoning: string }
  // Token usage to add onto the session counter; negative on a retry.
  | { type: "usage"; tokenUsage: TokenUsage }
  // The size of the persisted conversation the next prompt re-sends, and the
  // largest single call of the run.
  | { type: "context"; contextTokens: number; peakInputTokens: number }
  // A pending approval; the run ends after it.
  | { type: "interrupt"; value: ApprovalRequest }
  | { type: "error"; error: BridgeError }
  | { type: "done" }
  | BridgeCancelledEvent;

export type ExplainEvent =
  | { type: "text"; text: string }
  | { type: "error"; error: BridgeError }
  | { type: "done" }
  | BridgeCancelledEvent;

export const isApprovalRequest = (value: unknown): value is ApprovalRequest =>
  typeof value === "object" &&
  value !== null &&
  "question" in value &&
  "options" in value &&
  "actionToApprove" in value &&
  "requestString" in value;
