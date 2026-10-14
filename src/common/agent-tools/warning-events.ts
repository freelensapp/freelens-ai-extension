import { Type } from "typebox";

import type { AgentToolDefinition } from "./index";

export const getWarningEventsByNamespaceTool: AgentToolDefinition = {
  name: "getWarningEventsByNamespace",
  label: "Warning events",
  description:
    "Get all events of type Warning in a Kubernetes namespace, with their reason, message, action, source and " +
    "involved object. A good first step when asked what is failing in a namespace.",
  parameters: Type.Object({
    namespace: Type.String({ description: "The namespace to read warning events from" }),
  }),
  mutating: false,
  requiresApprovalByDefault: false,
};
