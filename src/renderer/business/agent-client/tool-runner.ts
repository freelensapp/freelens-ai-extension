import type { ToolRequest } from "../../../common/agent-protocol";

export type ToolImplementation = (args: Record<string, unknown>) => Promise<string> | string;

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
  implementations: Readonly<Record<string, ToolImplementation>>,
  { isClusterConnected = () => true }: { isClusterConnected?: () => boolean } = {},
): Promise<ToolReply> {
  const implementation = implementations[request.toolName];
  if (!implementation) {
    return { text: `Unknown tool: ${request.toolName}`, isError: true };
  }
  if (!isClusterConnected()) {
    return { text: "Cluster not connected", isError: true };
  }
  try {
    return { text: await implementation(request.args ?? {}), isError: false };
  } catch (error) {
    return {
      text: `${request.toolName} failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}
