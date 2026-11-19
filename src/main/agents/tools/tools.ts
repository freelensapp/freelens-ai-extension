// The Kubernetes tools of the agent, as AI SDK tools. Every tool acts on the
// cluster of its typed context (`contextSchema`), which the agent sets from the
// request's cluster id for every run (see freelens-agent.ts), never from module
// state: two cluster frames run at once.

import { type ToolApprovalConfiguration, type ToolApprovalStatus, type ToolLoopAgentSettings, tool } from "ai";
import { z } from "zod";
import { PreferencesStore } from "../../../common/store";
import {
  createKubernetesResource,
  deleteKubernetesResource,
  deletePod,
  getClusterVersion,
  getKubernetesResource,
  getNamespaces,
  getPodLogs,
  getWarningEventsByNamespace,
  listKubernetesResources,
  patchKubernetesResource,
  refuseBeforeApproval,
  restartKubernetesResource,
  updateKubernetesResource,
} from "./kubernetes-resource";
import { DELETE_MODES, POD_DELETE_MODES, RESTARTABLE_KINDS, SUPPORTED_KINDS } from "./resource-handlers";

import type { Manifest } from "./resource-handlers";

const supportedKindsHint = `Built-in kinds with extra validation: ${SUPPORTED_KINDS.join(", ")}. Any other kind (including CRDs) is also accepted and passed through as a free manifest; for those provide the apiVersion explicitly.`;

const kindSchema = z
  .string()
  .describe(`The Kubernetes resource kind, e.g. Pod, Deployment, Service or a CRD kind. ${supportedKindsHint}`);
const apiVersionSchema = z
  .string()
  .optional()
  .describe(
    'The apiVersion (group/version) of the resource, e.g. "v1" or "apps/v1". Required for kinds without a built-in default.',
  );
const manifestSchema = z.record(z.string(), z.any()).describe("The Kubernetes resource manifest as a JSON object.");
const includeManagedFieldsSchema = z
  .boolean()
  .optional()
  .describe(
    "Whether to include metadata.managedFields in the output. Defaults to false: the server-side apply " +
      "bookkeeping is large and irrelevant for analysis, so it is stripped to save context. Set to true only " +
      "when you specifically need to inspect field ownership.",
  );
const fieldsSchema = z
  .array(z.string())
  .optional()
  .describe(
    "Optional list of JSONPath-style field selectors (the kubectl `-o jsonpath` subset) applied to each " +
      "returned resource to trim the output to only the fields you need, instead of the full and often verbose " +
      "object. Each selector is relative to a single resource and the result keeps the nested structure of the " +
      'matched fields. Examples: ".metadata.name", ".status.phase", ".spec.containers[*].image", ' +
      '".metadata.labels[\'app.kubernetes.io/name\']", ".spec.containers[0].name". ' +
      "Omit to return the full resource.",
  );
const subresourceSchema = z
  .string()
  .optional()
  .describe(
    'Optional subresource to patch instead of the main resource. Use "resize" to change the CPU/memory ' +
      "requests and limits of a running Pod in place (Kubernetes 1.33+) without recreating it; the patch data " +
      "must carry the target container by name, e.g. { spec: { containers: [{ name, resources: { requests, limits } }] } }. " +
      'Use "scale" to change replicas. Omit for a normal patch.',
  );

// The context of every tool: the cluster of the chat the run belongs to.
const clusterContext = z.object({ clusterId: z.string() });

export const kubernetesTools = {
  getNamespaces: tool({
    description: "Get all namespaces of the Kubernetes cluster",
    inputSchema: z.object({}),
    contextSchema: clusterContext,
    execute: (_input, { context }) => getNamespaces(undefined, context.clusterId),
  }),
  getClusterVersion: tool({
    description:
      "Get the Kubernetes version of the currently connected cluster by querying the API server's /version endpoint " +
      "directly (the same server version that 'kubectl version' reports). Prefer this over inspecting node " +
      "kubeletVersions or other heuristics. Takes no arguments.",
    inputSchema: z.object({}),
    contextSchema: clusterContext,
    execute: (_input, { context }) => getClusterVersion(undefined, context.clusterId),
  }),
  getEventsForNamespace: tool({
    description: "Get all events in status WARNING for a specific Kubernetes namespace",
    inputSchema: z.object({ namespace: z.string() }),
    contextSchema: clusterContext,
    execute: (input, { context }) => getWarningEventsByNamespace(input, context.clusterId),
  }),
  listKubernetesResources: tool({
    description:
      "List Kubernetes resources of a given kind, optionally scoped to a namespace. " +
      "metadata.managedFields is stripped by default to keep the output small. " +
      'Pass "fields" with JSONPath-style selectors (e.g. [".metadata.name", ".status.phase"]) to return only ' +
      "a subset of each resource instead of the full, verbose object.",
    inputSchema: z.object({
      kind: kindSchema,
      apiVersion: apiVersionSchema,
      namespace: z.string().optional().describe("The namespace to list namespaced resources in"),
      includeManagedFields: includeManagedFieldsSchema,
      fields: fieldsSchema,
    }),
    contextSchema: clusterContext,
    execute: (input, { context }) => listKubernetesResources(input, context.clusterId),
  }),
  getKubernetesResource: tool({
    description:
      "Get a single Kubernetes resource by name (namespace required for namespaced kinds). " +
      "metadata.managedFields is stripped by default to keep the output small. " +
      'Pass "fields" with JSONPath-style selectors (e.g. [".status.phase", ".spec.containers[*].image"]) to ' +
      "return only a subset of the resource instead of the full, verbose object.",
    inputSchema: z.object({
      kind: kindSchema,
      apiVersion: apiVersionSchema,
      name: z.string().describe("The name of the resource"),
      namespace: z.string().optional().describe("The namespace of the resource (required for namespaced kinds)"),
      includeManagedFields: includeManagedFieldsSchema,
      fields: fieldsSchema,
    }),
    contextSchema: clusterContext,
    execute: (input, { context }) => getKubernetesResource(input, context.clusterId),
  }),
  getPodLogs: tool({
    description:
      "Read a one-shot snapshot of container logs from a pod. Namespace is required. If the container is omitted on a multi-container pod, the available containers are returned so one can be chosen. Use previous: true to read the last terminated instance (useful for CrashLoopBackOff). When you are looking for specific log content (errors, warnings, a keyword or pattern) PREFER passing filter with a regular expression to return only the matching lines (grep-style) instead of fetching the whole log and scanning it; read the full, unfiltered log only when the user asks for everything or a filtered read finds nothing.",
    inputSchema: z.object({
      name: z.string().describe("The name of the pod"),
      namespace: z.string().describe("The namespace of the pod"),
      container: z
        .string()
        .optional()
        .describe("The container to read logs from (required only for multi-container pods)"),
      previous: z
        .boolean()
        .optional()
        .describe("Read logs from the previous (terminated) container instance, e.g. for CrashLoopBackOff"),
      tailLines: z
        .number()
        .optional()
        .describe("Number of lines from the end of the logs to read (defaults to the preference value)"),
      timestamps: z.boolean().optional().describe("Prefix every log line with an RFC3339 timestamp"),
      filter: z
        .string()
        .optional()
        .describe(
          "Optional JavaScript regular expression used to keep only the log lines that match it (grep-style). " +
            "Prefer setting this whenever the goal is to find specific content (errors, warnings, a keyword or " +
            "pattern) so chatty logs are narrowed before they reach the model, instead of fetching every line. " +
            "Applied after tailLines and before any truncation. The match is case-sensitive and unanchored, " +
            'e.g. "error|err|fatal|panic" keeps lines mentioning those terms; add casing variants when case may ' +
            "differ. Omit to return every line.",
        ),
    }),
    contextSchema: clusterContext,
    execute: (input, { context }) => getPodLogs(input, context.clusterId),
  }),
  createKubernetesResource: tool({
    description: "Create a Kubernetes resource of any kind from a manifest",
    inputSchema: z.object({
      kind: kindSchema,
      apiVersion: apiVersionSchema,
      name: z.string().optional().describe("The name of the resource (defaults to metadata.name in the manifest)"),
      namespace: z
        .string()
        .optional()
        .describe("The namespace of the resource (defaults to metadata.namespace in the manifest)"),
      data: manifestSchema,
    }),
    contextSchema: clusterContext,
    execute: (input, { context }) =>
      createKubernetesResource({ ...input, data: input.data as Manifest }, context.clusterId),
  }),
  updateKubernetesResource: tool({
    description: "Update (replace, via PUT) an existing Kubernetes resource with a manifest",
    inputSchema: z.object({
      kind: kindSchema,
      apiVersion: apiVersionSchema,
      name: z.string().describe("The name of the resource to update"),
      namespace: z.string().optional().describe("The namespace of the resource (required for namespaced kinds)"),
      data: manifestSchema,
    }),
    contextSchema: clusterContext,
    execute: (input, { context }) =>
      updateKubernetesResource({ ...input, data: input.data as Manifest }, context.clusterId),
  }),
  patchKubernetesResource: tool({
    description:
      "Patch (via PATCH) an existing Kubernetes resource with a partial manifest. " +
      'Set the optional "subresource" to patch a subresource instead of the main resource: use "resize" to change ' +
      "the CPU/memory requests and limits of a running Pod in place (Kubernetes 1.33+) instead of recreating it, " +
      'or "scale" to change replicas.',
    inputSchema: z.object({
      kind: kindSchema,
      apiVersion: apiVersionSchema,
      name: z.string().describe("The name of the resource to patch"),
      namespace: z.string().optional().describe("The namespace of the resource (required for namespaced kinds)"),
      data: manifestSchema.describe("The partial Kubernetes manifest to merge into the resource"),
      subresource: subresourceSchema,
    }),
    contextSchema: clusterContext,
    execute: (input, { context }) =>
      patchKubernetesResource({ ...input, data: input.data as Manifest }, context.clusterId),
  }),
  deleteKubernetesResource: tool({
    description:
      "Delete a Kubernetes resource by name (namespace required for namespaced kinds). " +
      'The optional "mode" selects how the deletion is performed: "delete" (default) is a normal delete; ' +
      '"force_delete" deletes immediately with a zero grace period (use when a normal delete hangs); ' +
      '"force_finalize" clears the resource finalizers so an object stuck in Terminating can be removed ' +
      "(use only as a last resort, after a normal or force delete did not complete). " +
      "For pods prefer the dedicated deletePod tool, which can also evict respecting PodDisruptionBudgets.",
    inputSchema: z.object({
      kind: kindSchema,
      apiVersion: apiVersionSchema,
      name: z.string().describe("The name of the resource to delete"),
      namespace: z.string().optional().describe("The namespace of the resource (required for namespaced kinds)"),
      mode: z
        .enum(DELETE_MODES)
        .optional()
        .describe(
          'How to delete the resource. "delete" (default): normal delete. ' +
            '"force_delete": immediate delete with grace period 0 when a normal delete hangs. ' +
            '"force_finalize": clear finalizers to unstick a resource in Terminating (last resort).',
        ),
    }),
    contextSchema: clusterContext,
    execute: (input, { context }) => deleteKubernetesResource(input, context.clusterId),
  }),
  deletePod: tool({
    description:
      "Delete a single pod using a pod-specific variant. Namespace is required. " +
      'The "mode" selects the behavior: "evict" requests a graceful eviction that honors any matching ' +
      'PodDisruptionBudget (prefer this for draining or voluntary disruptions); "force_delete" deletes the pod ' +
      "immediately with a zero grace period (use for pods stuck on an unreachable or NotReady node); " +
      '"delete_with_finalizers" deletes the pod and clears its finalizers (last resort for a pod stuck in Terminating). ' +
      "For a plain pod delete, use deleteKubernetesResource instead.",
    inputSchema: z.object({
      name: z.string().describe("The name of the pod to delete"),
      namespace: z.string().describe("The namespace of the pod"),
      mode: z
        .enum(POD_DELETE_MODES)
        .describe(
          '"evict": graceful eviction honoring PodDisruptionBudgets. ' +
            '"force_delete": immediate delete with grace period 0 for pods stuck on an unreachable node. ' +
            '"delete_with_finalizers": delete and clear finalizers to unstick a pod in Terminating (last resort).',
        ),
    }),
    contextSchema: clusterContext,
    execute: (input, { context }) => deletePod(input, context.clusterId),
  }),
  restartKubernetesResource: tool({
    description: `Trigger a rollout restart of a workload (rolls its pods without deleting them directly), like "kubectl rollout restart". Namespace is required. Supported kinds: ${RESTARTABLE_KINDS.join(", ")}.`,
    inputSchema: z.object({
      kind: z.string().describe(`The workload kind to restart. Supported kinds: ${RESTARTABLE_KINDS.join(", ")}.`),
      name: z.string().describe("The name of the workload to restart"),
      namespace: z.string().describe("The namespace of the workload"),
    }),
    contextSchema: clusterContext,
    execute: (input, { context }) => restartKubernetesResource(input, context.clusterId),
  }),
};

export type KubernetesTools = typeof kubernetesTools;

// The context of the tools, by tool name, as an agent takes it.
type KubernetesToolsContext = NonNullable<ToolLoopAgentSettings<never, KubernetesTools>["toolsContext"]>;

/** The context of every Kubernetes tool for a run on the given cluster. */
export const kubernetesToolsContext = (clusterId: string): KubernetesToolsContext =>
  Object.fromEntries(Object.keys(kubernetesTools).map((name) => [name, { clusterId }])) as KubernetesToolsContext;

// The approval of a write: refused at once, with the reason for the model, when
// it would fail before it reaches the cluster; otherwise asked from the user.
const writeApproval =
  (toolName: string) =>
  (input: Record<string, unknown>): ToolApprovalStatus => {
    const reason = refuseBeforeApproval(toolName, input);
    return reason ? { type: "denied", reason } : "user-approval";
  };

/**
 * Which calls the user approves before they run: every write, and the pod logs
 * when the preferences ask for it. Evaluated again by the AI SDK when an
 * approval is answered.
 */
export const kubernetesToolApproval = (): ToolApprovalConfiguration<KubernetesTools, never> => ({
  createKubernetesResource: writeApproval("createKubernetesResource"),
  updateKubernetesResource: writeApproval("updateKubernetesResource"),
  patchKubernetesResource: writeApproval("patchKubernetesResource"),
  deleteKubernetesResource: writeApproval("deleteKubernetesResource"),
  deletePod: writeApproval("deletePod"),
  restartKubernetesResource: writeApproval("restartKubernetesResource"),
  getPodLogs: () =>
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().podLogsRequireApproval ? "user-approval" : undefined,
});

// Data structure describing each tool function: name, description, arguments, and return type
export const toolFunctionDescriptions = [
  {
    name: "getNamespaces",
    description: "Get all namespaces of the Kubernetes cluster",
    arguments: "No arguments. The function does not require any input.",
    returnType: "Returns a list of all namespace names as strings.",
  },
  {
    name: "getClusterVersion",
    description: "Get the Kubernetes server version of the currently connected cluster",
    arguments: "No arguments. The function does not require any input.",
    returnType:
      'Returns a JSON string with the cluster version (the gitVersion, e.g. "v1.29.2") and related details such as major, minor, gitCommit, buildDate, goVersion and platform.',
  },
  {
    name: "getWarningEventsByNamespace",
    description: "Get all events in status WARNING for a specific Kubernetes namespace",
    arguments: "Requires the namespace name as a string.",
    returnType: "Returns a JSON string containing all warning events for the given namespace.",
  },
  {
    name: "listKubernetesResources",
    description: "List Kubernetes resources of a given kind, optionally scoped to a namespace",
    arguments:
      "Requires the resource kind (string) and optionally the apiVersion (string), namespace (string), " +
      "includeManagedFields (boolean; defaults to false) and fields (array of JSONPath-style selectors to " +
      "trim each resource to a subset, the kubectl `-o jsonpath` subset). Built-in kinds: " +
      SUPPORTED_KINDS.join(", ") +
      "; any other kind (including CRDs) is accepted.",
    returnType:
      "Returns a JSON string containing the matching resources, with metadata.managedFields stripped unless " +
      "includeManagedFields is true, and limited to the selected fields when fields is provided.",
  },
  {
    name: "getKubernetesResource",
    description: "Get a single Kubernetes resource by name",
    arguments:
      "Requires the resource kind (string) and name (string), and optionally the apiVersion (string), " +
      "includeManagedFields (boolean; defaults to false) and fields (array of JSONPath-style selectors to " +
      "trim the resource to a subset, the kubectl `-o jsonpath` subset). Namespace (string) is required for " +
      "namespaced kinds.",
    returnType:
      "Returns a JSON string containing the requested resource, with metadata.managedFields stripped unless " +
      "includeManagedFields is true, and limited to the selected fields when fields is provided.",
  },
  {
    name: "getPodLogs",
    description: "Read a one-shot snapshot of container logs from a pod",
    arguments:
      "Requires the pod name (string) and namespace (string), and optionally the container (string; required only for multi-container pods), previous (boolean, for terminated instances), tailLines (number), timestamps (boolean) and filter (string; a regular expression that keeps only matching log lines, grep-style - prefer it when searching for specific content such as errors or warnings instead of reading the whole log).",
    returnType:
      "Returns the (possibly truncated and filtered) container logs as a string, or the list of containers to choose from for multi-container pods.",
  },
  {
    name: "createKubernetesResource",
    description: "Create a Kubernetes resource of any kind from a manifest",
    arguments:
      "Requires the resource kind (string) and the manifest data (object), and optionally the apiVersion (string), name (string) and namespace (string).",
    returnType: "Returns a message string indicating success or error after attempting to create the resource.",
  },
  {
    name: "updateKubernetesResource",
    description: "Update (replace, via PUT) an existing Kubernetes resource with a manifest",
    arguments:
      "Requires the resource kind (string), name (string) and the manifest data (object), and optionally the apiVersion (string) and namespace (string).",
    returnType: "Returns a message string indicating success or error after attempting to update the resource.",
  },
  {
    name: "patchKubernetesResource",
    description: "Patch (via PATCH) an existing Kubernetes resource with a partial manifest",
    arguments:
      'Requires the resource kind (string), name (string) and the partial manifest data (object), and optionally the apiVersion (string), namespace (string) and subresource (string; e.g. "resize" to change a running Pod\'s CPU/memory in place, or "scale").',
    returnType: "Returns a message string indicating success or error after attempting to patch the resource.",
  },
  {
    name: "deleteKubernetesResource",
    description: "Delete a Kubernetes resource by name, optionally with a force delete or finalize mode",
    arguments:
      "Requires the resource kind (string) and name (string), and optionally the apiVersion (string) and a mode (string: " +
      DELETE_MODES.join(", ") +
      "; defaults to delete). Namespace (string) is required for namespaced kinds.",
    returnType: "Returns a message string indicating success or error after attempting to delete the resource.",
  },
  {
    name: "deletePod",
    description: "Delete a single pod via a pod-specific variant (evict, force delete, or delete with finalizers)",
    arguments:
      "Requires the pod name (string), namespace (string) and mode (string: " + POD_DELETE_MODES.join(", ") + ").",
    returnType: "Returns a message string indicating success or error after attempting to delete the pod.",
  },
  {
    name: "restartKubernetesResource",
    description: 'Trigger a rollout restart of a workload (like "kubectl rollout restart")',
    arguments:
      "Requires the workload kind (string), name (string) and namespace (string). Supported kinds: " +
      RESTARTABLE_KINDS.join(", ") +
      ".",
    returnType: "Returns a message string indicating success or error after attempting to restart the workload.",
  },
];
