import { getClusterVersionTool } from "./cluster-version";
import { getKubernetesResourceTool, listKubernetesResourcesTool } from "./kubernetes-resources";
import { getNamespacesTool } from "./namespaces";
import { getPodLogsTool } from "./pod-logs-tool";
import { getWarningEventsByNamespaceTool } from "./warning-events";
import {
  createKubernetesResourceTool,
  deleteKubernetesResourceTool,
  deletePodTool,
  patchKubernetesResourceTool,
  restartKubernetesResourceTool,
  updateKubernetesResourceTool,
} from "./write-tools";

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

export const AGENT_TOOLS: readonly AgentToolDefinition[] = [
  getClusterVersionTool,
  getNamespacesTool,
  getWarningEventsByNamespaceTool,
  listKubernetesResourcesTool,
  getKubernetesResourceTool,
  getPodLogsTool,
  createKubernetesResourceTool,
  updateKubernetesResourceTool,
  patchKubernetesResourceTool,
  deleteKubernetesResourceTool,
  deletePodTool,
  restartKubernetesResourceTool,
];

export {
  createKubernetesResourceTool,
  deleteKubernetesResourceTool,
  deletePodTool,
  getClusterVersionTool,
  getKubernetesResourceTool,
  getNamespacesTool,
  getPodLogsTool,
  getWarningEventsByNamespaceTool,
  listKubernetesResourcesTool,
  patchKubernetesResourceTool,
  restartKubernetesResourceTool,
  updateKubernetesResourceTool,
};
