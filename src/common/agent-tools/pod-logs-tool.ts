import { Type } from "typebox";

import type { AgentToolDefinition } from "./index";

// A read tool, but logs can carry secrets, so it asks for approval by default.
export const getPodLogsTool: AgentToolDefinition = {
  name: "getPodLogs",
  label: "Read pod logs",
  description:
    "Read a one-shot snapshot of container logs from a pod. Namespace is required. If the container is omitted on " +
    "a multi-container pod, the available containers are returned so one can be chosen. Use previous: true to read " +
    "the last terminated instance (useful for CrashLoopBackOff). When you are looking for specific log content " +
    "(errors, warnings, a keyword or pattern) PREFER passing filter with a regular expression to return only the " +
    "matching lines (grep-style) instead of fetching the whole log and scanning it; read the full, unfiltered log " +
    "only when the user asks for everything or a filtered read finds nothing.",
  parameters: Type.Object({
    name: Type.String({ description: "The name of the pod" }),
    namespace: Type.String({ description: "The namespace of the pod" }),
    container: Type.Optional(
      Type.String({ description: "The container to read logs from (required only for multi-container pods)" }),
    ),
    previous: Type.Optional(
      Type.Boolean({
        description: "Read logs from the previous (terminated) container instance, e.g. for CrashLoopBackOff",
      }),
    ),
    tailLines: Type.Optional(
      Type.Number({
        description: "Number of lines from the end of the logs to read (defaults to the preference value)",
      }),
    ),
    timestamps: Type.Optional(Type.Boolean({ description: "Prefix every log line with an RFC3339 timestamp" })),
    filter: Type.Optional(
      Type.String({
        description:
          "Optional JavaScript regular expression used to keep only the log lines that match it (grep-style). " +
          "Prefer setting this whenever the goal is to find specific content (errors, warnings, a keyword or " +
          "pattern) so chatty logs are narrowed before they reach the model, instead of fetching every line. " +
          "Applied after tailLines and before any truncation. The match is case-sensitive and unanchored, " +
          'e.g. "error|err|fatal|panic" keeps lines mentioning those terms; add casing variants when case may ' +
          "differ. Omit to return every line.",
      }),
    ),
  }),
  mutating: false,
  requiresApprovalByDefault: true,
};
