import { Value } from "typebox/value";

import type { ToolRequest } from "../../../common/agent-protocol";
import type { AgentToolDefinition } from "../../../common/agent-tools";

export type ToolImplementation = (args: Record<string, unknown>) => Promise<string> | string;

/** A shared tool definition and the frame code that runs it against the cluster. */
export interface ClusterTool {
  definition: AgentToolDefinition;
  run: ToolImplementation;
}

export interface ToolReply {
  text: string;
  isError: boolean;
}

/**
 * Runs a tool call that main sent to this cluster frame. Never throws: every
 * failure becomes an error text that main hands to the model.
 */
export async function runToolRequest(
  request: ToolRequest,
  tools: Readonly<Record<string, ClusterTool>>,
  { isClusterConnected = () => true }: { isClusterConnected?: () => boolean } = {},
): Promise<ToolReply> {
  const tool = Object.hasOwn(tools, request.toolName) ? tools[request.toolName] : undefined;
  if (!tool) {
    return { text: `Unknown tool: ${request.toolName}`, isError: true };
  }
  const args = request.args ?? {};
  // Main validates too; this guards the frame against a request that skipped it.
  const errors = Value.Errors(tool.definition.parameters, args);
  if (errors.length > 0) {
    const details = errors.map((error) => `${error.instancePath ? `${error.instancePath} ` : ""}${error.message}`);
    return { text: `Invalid arguments for ${request.toolName}: ${details.join("; ")}`, isError: true };
  }
  if (!isClusterConnected()) {
    return { text: "Cluster not connected", isError: true };
  }
  try {
    return { text: await tool.run(args), isError: false };
  } catch (error) {
    return { text: `${request.toolName} failed: ${describeError(error)}`, isError: true };
  }
}

// The cluster API can reject with plain objects (for example a parsed Kubernetes Status).
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      // Circular: fall through.
    }
  }
  return String(error);
}
