import { Type } from "typebox";

import type { AgentToolDefinition } from "./index";

export const getNamespacesTool: AgentToolDefinition = {
  name: "getNamespaces",
  label: "Namespaces",
  description: "Get the names of all namespaces of the Kubernetes cluster as a JSON array. Takes no arguments.",
  parameters: Type.Object({}),
  mutating: false,
  requiresApprovalByDefault: false,
};
