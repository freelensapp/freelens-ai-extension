import { Renderer } from "@freelensapp/extensions";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  createKubernetesResource as createKubernetesResourceImpl,
  deleteKubernetesResource as deleteKubernetesResourceImpl,
  deletePod as deletePodImpl,
  getKubernetesResource as getKubernetesResourceImpl,
  getPodLogs as getPodLogsImpl,
  listKubernetesResources as listKubernetesResourcesImpl,
  patchKubernetesResource as patchKubernetesResourceImpl,
  restartKubernetesResource as restartKubernetesResourceImpl,
  updateKubernetesResource as updateKubernetesResourceImpl,
} from "./kubernetes-resource";
import { DELETE_MODES, POD_DELETE_MODES, RESTARTABLE_KINDS, SUPPORTED_KINDS } from "./resource-handlers";

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
const manifestSchema = z.record(z.any()).describe("The Kubernetes resource manifest as a JSON object.");
const subresourceSchema = z
  .string()
  .optional()
  .describe(
    'Optional subresource to patch instead of the main resource. Use "resize" to change the CPU/memory ' +
      "requests and limits of a running Pod in place (Kubernetes 1.33+) without recreating it; the patch data " +
      "must carry the target container by name, e.g. { spec: { containers: [{ name, resources: { requests, limits } }] } }. " +
      'Use "scale" to change replicas. Omit for a normal patch.',
  );

export const getNamespaces = tool(
  (): string[] => {
    /**
     * Get all namespaces of the Kubernetes cluster
     */
    console.log("[Tool invocation: getNamespaces]");
    const namespaceStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.namespacesApi);
    if (!namespaceStore) {
      console.log("Namespace store does not exist");
      return [];
    }
    const allNamespaces: Renderer.K8sApi.Namespace[] = namespaceStore.items.toJSON();
    const getNamespacesToolResult = allNamespaces.map((ns) => ns.getName());
    console.log("[Tool invocation result: getNamespaces] - ", getNamespacesToolResult);
    return getNamespacesToolResult;
  },
  {
    name: "getNamespaces",
    description: "Get all namespaces of the Kubernetes cluster",
  },
);

export const getWarningEventsByNamespace = tool(
  ({ namespace }: { namespace: string }): string => {
    /**
     * Get all events in status WARNING for a specific Kubernetes namespace
     */
    console.log("[Tool invocation: getWarningEventsForNamespace] - namespace: ", namespace);
    const eventStore = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.eventApi);
    if (!eventStore) {
      return "Event store does not exist";
    }
    const allEventsByNs: Renderer.K8sApi.KubeEvent[] = eventStore.getAllByNs(namespace);
    console.log("[Tool invocation debug: getWarningEventsForNamespace] - all WARNING events: ", allEventsByNs);
    const getWarningEventsByNsToolResult = JSON.stringify(
      allEventsByNs
        .filter((event) => event.type === "Warning")
        .map((event) => ({
          event: {
            type: event.type,
            message: event.message,
            reason: event.reason,
            action: event.action,
            involvedObject: event.involvedObject,
            source: event.source,
          },
        })),
    );
    console.log("[Tool invocation result: getWarningEventsForNamespace] - ", getWarningEventsByNsToolResult);
    return getWarningEventsByNsToolResult;
  },
  {
    name: "getEventsForNamespace",
    description: "Get all events in status WARNING for a specific Kubernetes namespace",
    schema: z.object({
      namespace: z.string(),
    }),
  },
);

export const listKubernetesResources = tool(listKubernetesResourcesImpl, {
  name: "listKubernetesResources",
  description: "List Kubernetes resources of a given kind, optionally scoped to a namespace",
  schema: z.object({
    kind: kindSchema,
    apiVersion: apiVersionSchema,
    namespace: z.string().optional().describe("The namespace to list namespaced resources in"),
  }),
});

export const getKubernetesResource = tool(getKubernetesResourceImpl, {
  name: "getKubernetesResource",
  description: "Get a single Kubernetes resource by name (namespace required for namespaced kinds)",
  schema: z.object({
    kind: kindSchema,
    apiVersion: apiVersionSchema,
    name: z.string().describe("The name of the resource"),
    namespace: z.string().optional().describe("The namespace of the resource (required for namespaced kinds)"),
  }),
});

export const createKubernetesResource = tool(createKubernetesResourceImpl, {
  name: "createKubernetesResource",
  description: "Create a Kubernetes resource of any kind from a manifest",
  schema: z.object({
    kind: kindSchema,
    apiVersion: apiVersionSchema,
    name: z.string().optional().describe("The name of the resource (defaults to metadata.name in the manifest)"),
    namespace: z
      .string()
      .optional()
      .describe("The namespace of the resource (defaults to metadata.namespace in the manifest)"),
    data: manifestSchema,
  }),
});

export const updateKubernetesResource = tool(updateKubernetesResourceImpl, {
  name: "updateKubernetesResource",
  description: "Update (replace, via PUT) an existing Kubernetes resource with a manifest",
  schema: z.object({
    kind: kindSchema,
    apiVersion: apiVersionSchema,
    name: z.string().describe("The name of the resource to update"),
    namespace: z.string().optional().describe("The namespace of the resource (required for namespaced kinds)"),
    data: manifestSchema,
  }),
});

export const patchKubernetesResource = tool(patchKubernetesResourceImpl, {
  name: "patchKubernetesResource",
  description:
    "Patch (via PATCH) an existing Kubernetes resource with a partial manifest. " +
    'Set the optional "subresource" to patch a subresource instead of the main resource: use "resize" to change ' +
    "the CPU/memory requests and limits of a running Pod in place (Kubernetes 1.33+) instead of recreating it, " +
    'or "scale" to change replicas.',
  schema: z.object({
    kind: kindSchema,
    apiVersion: apiVersionSchema,
    name: z.string().describe("The name of the resource to patch"),
    namespace: z.string().optional().describe("The namespace of the resource (required for namespaced kinds)"),
    data: manifestSchema.describe("The partial Kubernetes manifest to merge into the resource"),
    subresource: subresourceSchema,
  }),
});

export const getPodLogs = tool(getPodLogsImpl, {
  name: "getPodLogs",
  description:
    "Read a one-shot snapshot of container logs from a pod. Namespace is required. If the container is omitted on a multi-container pod, the available containers are returned so one can be chosen. Use previous: true to read the last terminated instance (useful for CrashLoopBackOff).",
  schema: z.object({
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
  }),
});

export const deleteKubernetesResource = tool(deleteKubernetesResourceImpl, {
  name: "deleteKubernetesResource",
  description:
    "Delete a Kubernetes resource by name (namespace required for namespaced kinds). " +
    'The optional "mode" selects how the deletion is performed: "delete" (default) is a normal delete; ' +
    '"force_delete" deletes immediately with a zero grace period (use when a normal delete hangs); ' +
    '"force_finalize" clears the resource finalizers so an object stuck in Terminating can be removed ' +
    "(use only as a last resort, after a normal or force delete did not complete). " +
    "For pods prefer the dedicated deletePod tool, which can also evict respecting PodDisruptionBudgets.",
  schema: z.object({
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
});

export const deletePod = tool(deletePodImpl, {
  name: "deletePod",
  description:
    "Delete a single pod using a pod-specific variant. Namespace is required. " +
    'The "mode" selects the behavior: "evict" requests a graceful eviction that honors any matching ' +
    'PodDisruptionBudget (prefer this for draining or voluntary disruptions); "force_delete" deletes the pod ' +
    "immediately with a zero grace period (use for pods stuck on an unreachable or NotReady node); " +
    '"delete_with_finalizers" deletes the pod and clears its finalizers (last resort for a pod stuck in Terminating). ' +
    "For a plain pod delete, use deleteKubernetesResource instead.",
  schema: z.object({
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
});

export const restartKubernetesResource = tool(restartKubernetesResourceImpl, {
  name: "restartKubernetesResource",
  description: `Trigger a rollout restart of a workload (rolls its pods without deleting them directly), like "kubectl rollout restart". Namespace is required. Supported kinds: ${RESTARTABLE_KINDS.join(", ")}.`,
  schema: z.object({
    kind: z.string().describe(`The workload kind to restart. Supported kinds: ${RESTARTABLE_KINDS.join(", ")}.`),
    name: z.string().describe("The name of the workload to restart"),
    namespace: z.string().describe("The namespace of the workload"),
  }),
});

export const allToolFunctions = [
  getNamespaces,
  getWarningEventsByNamespace,
  listKubernetesResources,
  getKubernetesResource,
  getPodLogs,
  createKubernetesResource,
  updateKubernetesResource,
  patchKubernetesResource,
  deleteKubernetesResource,
  deletePod,
  restartKubernetesResource,
];

// The authoritative set of tool names the agent system can actually execute.
// Used to detect hallucinated / unsupported tool calls (for example a shell
// `runCommand`) before they reach the graph. Note the registered name of the
// warning-events tool is `getEventsForNamespace`.
export const allToolNames: string[] = allToolFunctions.map((tool) => tool.name);

// Data structure describing each tool function: name, description, arguments, and return type
export const toolFunctionDescriptions = [
  {
    name: "getNamespaces",
    description: "Get all namespaces of the Kubernetes cluster",
    arguments: "No arguments. The function does not require any input.",
    returnType: "Returns a list of all namespace names as strings.",
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
      "Requires the resource kind (string) and optionally the apiVersion (string) and namespace (string). Built-in kinds: " +
      SUPPORTED_KINDS.join(", ") +
      "; any other kind (including CRDs) is accepted.",
    returnType: "Returns a JSON string containing the matching resources.",
  },
  {
    name: "getKubernetesResource",
    description: "Get a single Kubernetes resource by name",
    arguments:
      "Requires the resource kind (string) and name (string), and optionally the apiVersion (string). Namespace (string) is required for namespaced kinds.",
    returnType: "Returns a JSON string containing the requested resource.",
  },
  {
    name: "getPodLogs",
    description: "Read a one-shot snapshot of container logs from a pod",
    arguments:
      "Requires the pod name (string) and namespace (string), and optionally the container (string; required only for multi-container pods), previous (boolean, for terminated instances), tailLines (number) and timestamps (boolean).",
    returnType:
      "Returns the (possibly truncated) container logs as a string, or the list of containers to choose from for multi-container pods.",
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
