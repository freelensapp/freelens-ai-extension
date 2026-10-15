import { BridgeRoute } from "../../common/bridge/protocol";

import type {
  AgentRunInput,
  AgentRunRequest,
  ConversationRequest,
  ExplainRequest,
  ModelPricingResponse,
  ToolsResponse,
} from "../../common/bridge/protocol";
import type { AgentRuntime } from "../agents/agent-runtime";
import type { BridgeRoutes } from "./server";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const requireString = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The request has no "${key}".`);
  }
  return value;
};

const requireRecord = (body: unknown): Record<string, unknown> => {
  if (!isRecord(body)) {
    throw new Error("The request has no JSON body.");
  }
  return body;
};

export const parseConversationRequest = (body: unknown): ConversationRequest => {
  const record = requireRecord(body);
  return { clusterId: requireString(record, "clusterId"), conversationId: requireString(record, "conversationId") };
};

const parseRunInput = (input: unknown): AgentRunInput => {
  const record = requireRecord(input);
  if (record.kind === "resume") {
    return { kind: "resume", answer: requireString(record, "answer") };
  }
  if (record.kind === "message") {
    const summary = typeof record.summary === "string" ? record.summary : null;
    return { kind: "message", text: requireString(record, "text"), summary };
  }
  throw new Error("The run input has an unknown kind.");
};

export const parseAgentRunRequest = (body: unknown): AgentRunRequest => ({
  ...parseConversationRequest(body),
  input: parseRunInput(requireRecord(body).input),
});

export const parseExplainRequest = (body: unknown): ExplainRequest => {
  const record = requireRecord(body);
  return { clusterId: requireString(record, "clusterId"), text: requireString(record, "text") };
};

// The cluster whose tools are listed: the MCP servers run per cluster.
export const parseToolsQuery = (query: URLSearchParams): string => {
  const clusterId = query.get("clusterId");
  if (!clusterId) {
    throw new Error('The request has no "clusterId".');
  }
  return clusterId;
};

export const createBridgeRoutes = ({
  runtime,
  fetchModelPricing,
}: {
  runtime: AgentRuntime;
  fetchModelPricing: () => Promise<ModelPricingResponse>;
}): BridgeRoutes => ({
  [BridgeRoute.run]: {
    method: "POST",
    kind: "stream",
    handle: ({ body, signal }) => runtime.run(parseAgentRunRequest(body), signal),
  },
  [BridgeRoute.explain]: {
    method: "POST",
    kind: "stream",
    handle: ({ body, signal }) => runtime.explain(parseExplainRequest(body), signal),
  },
  [BridgeRoute.compact]: {
    method: "POST",
    kind: "json",
    handle: ({ body }) => runtime.compact(parseConversationRequest(body)),
  },
  [BridgeRoute.clear]: {
    method: "POST",
    kind: "json",
    handle: ({ body }) => runtime.clear(parseConversationRequest(body)),
  },
  [BridgeRoute.tools]: {
    method: "GET",
    kind: "json",
    handle: async ({ query }): Promise<ToolsResponse> => ({ tools: await runtime.tools(parseToolsQuery(query)) }),
  },
  [BridgeRoute.modelPricing]: {
    method: "GET",
    kind: "json",
    handle: () => fetchModelPricing(),
  },
});
