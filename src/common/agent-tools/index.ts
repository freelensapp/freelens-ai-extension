import { helmTool } from "./helm-tool";
import { kubectlTool } from "./kubectl-tool";

import type { TSchema } from "typebox";

/**
 * One tool of the agent, shared by main and the cluster frame. Main turns it
 * into a pi tool that runs CLI invocations (src/main/agent/cli-gate.ts); the
 * renderer reads the definitions for the chat's tool list.
 */
export interface AgentToolDefinition<TParams extends TSchema = TSchema> {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
}

export const AGENT_TOOLS: readonly AgentToolDefinition[] = [kubectlTool, helmTool];

export { helmTool, kubectlTool };
