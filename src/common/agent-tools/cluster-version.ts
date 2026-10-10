import { Type } from "typebox";

import type { AgentToolDefinition } from "./index";

export const getClusterVersionTool: AgentToolDefinition = {
  name: "getClusterVersion",
  label: "Cluster version",
  description:
    "Get the Kubernetes version of the currently connected cluster by querying the API server's /version endpoint " +
    "directly (the same server version that 'kubectl version' reports). Prefer this over inspecting node " +
    "kubeletVersions or other heuristics. Takes no arguments.",
  parameters: Type.Object({}),
  mutating: false,
  requiresApprovalByDefault: false,
};
