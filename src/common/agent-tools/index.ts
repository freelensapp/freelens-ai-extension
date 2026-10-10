import { getClusterVersionTool } from "./cluster-version";

import type { TSchema } from "typebox";

/**
 * One cluster tool, shared by main and the cluster frame. Main turns it into a
 * pi tool that forwards each call to the frame; the frame maps the name to the
 * implementation that talks to the cluster.
 */
export interface AgentToolDefinition<TParams extends TSchema = TSchema> {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  /** Changes the cluster: runs one at a time and is listed in the approval settings. */
  mutating: boolean;
  requiresApprovalByDefault: boolean;
}

export const AGENT_TOOLS: readonly AgentToolDefinition[] = [getClusterVersionTool];

export { getClusterVersionTool };
