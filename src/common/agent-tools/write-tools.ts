import { Type } from "typebox";
import { apiVersionSchema } from "./kubernetes-resources";
import { DELETE_MODES, POD_DELETE_MODES, RESTARTABLE_KINDS, SUPPORTED_KINDS } from "./resource-handlers";

import type { AgentToolDefinition } from "./index";

// The tools that change the cluster. Each asks for approval by default and
// runs one at a time.

const literals = (values: readonly string[], options: { description: string }) =>
  Type.Union(
    values.map((value) => Type.Literal(value)),
    options,
  );

const writeKindSchema = Type.String({
  description:
    "The Kubernetes resource kind, e.g. Pod, Deployment, Service or a CRD kind such as Gateway. " +
    `Built-in kinds with extra manifest validation: ${SUPPORTED_KINDS.join(", ")}. ` +
    "Any other kind is passed through as a free manifest; provide its apiVersion explicitly.",
});

const manifestSchema = (description: string) => Type.Record(Type.String(), Type.Unknown(), { description });

const namespaceSchema = Type.Optional(
  Type.String({ description: "The namespace of the resource (required for namespaced kinds)" }),
);

export const createKubernetesResourceTool: AgentToolDefinition = {
  name: "createKubernetesResource",
  label: "Create resource",
  description: "Create a Kubernetes resource of any kind from a manifest.",
  parameters: Type.Object({
    kind: writeKindSchema,
    apiVersion: apiVersionSchema,
    name: Type.Optional(
      Type.String({ description: "The name of the resource (defaults to metadata.name in the manifest)" }),
    ),
    namespace: Type.Optional(
      Type.String({ description: "The namespace of the resource (defaults to metadata.namespace in the manifest)" }),
    ),
    data: manifestSchema("The Kubernetes resource manifest as a JSON object."),
  }),
  mutating: true,
  requiresApprovalByDefault: true,
};

export const updateKubernetesResourceTool: AgentToolDefinition = {
  name: "updateKubernetesResource",
  label: "Update resource",
  description: "Update (replace, via PUT) an existing Kubernetes resource with a full manifest.",
  parameters: Type.Object({
    kind: writeKindSchema,
    apiVersion: apiVersionSchema,
    name: Type.String({ description: "The name of the resource to update" }),
    namespace: namespaceSchema,
    data: manifestSchema("The full Kubernetes resource manifest as a JSON object."),
  }),
  mutating: true,
  requiresApprovalByDefault: true,
};

export const patchKubernetesResourceTool: AgentToolDefinition = {
  name: "patchKubernetesResource",
  label: "Patch resource",
  description:
    "Patch (via PATCH, a JSON merge patch) an existing Kubernetes resource with a partial manifest. " +
    'Set the optional "subresource" to patch a subresource instead of the main resource: use "resize" to change ' +
    "the CPU/memory requests and limits of a running Pod in place (Kubernetes 1.33+) instead of recreating it, " +
    'or "scale" to change replicas.',
  parameters: Type.Object({
    kind: writeKindSchema,
    apiVersion: apiVersionSchema,
    name: Type.String({ description: "The name of the resource to patch" }),
    namespace: namespaceSchema,
    data: manifestSchema("The partial Kubernetes manifest to merge into the resource."),
    subresource: Type.Optional(
      Type.String({
        description:
          'Optional subresource to patch instead of the main resource. Use "resize" to change the CPU/memory ' +
          "requests and limits of a running Pod in place (Kubernetes 1.33+) without recreating it; the patch data " +
          "must carry the target container by name, e.g. { spec: { containers: [{ name, resources: { requests, limits } }] } }. " +
          'Use "scale" to change replicas, e.g. { spec: { replicas: 3 } }. Omit for a normal patch.',
      }),
    ),
  }),
  mutating: true,
  requiresApprovalByDefault: true,
};

export const deleteKubernetesResourceTool: AgentToolDefinition = {
  name: "deleteKubernetesResource",
  label: "Delete resource",
  description:
    "Delete a Kubernetes resource by name (namespace required for namespaced kinds). " +
    'The optional "mode" selects how the deletion is performed: "delete" (default) is a normal delete; ' +
    '"force_delete" deletes immediately with a zero grace period (use when a normal delete hangs); ' +
    '"force_finalize" clears the resource finalizers so an object stuck in Terminating can be removed ' +
    "(use only as a last resort, after a normal or force delete did not complete). " +
    "For pods prefer the dedicated deletePod tool, which can also evict respecting PodDisruptionBudgets.",
  parameters: Type.Object({
    kind: writeKindSchema,
    apiVersion: apiVersionSchema,
    name: Type.String({ description: "The name of the resource to delete" }),
    namespace: namespaceSchema,
    mode: Type.Optional(
      literals(DELETE_MODES, {
        description:
          'How to delete the resource. "delete" (default): normal delete. ' +
          '"force_delete": immediate delete with grace period 0 when a normal delete hangs. ' +
          '"force_finalize": clear finalizers to unstick a resource in Terminating (last resort).',
      }),
    ),
  }),
  mutating: true,
  requiresApprovalByDefault: true,
};

export const deletePodTool: AgentToolDefinition = {
  name: "deletePod",
  label: "Delete pod",
  description:
    "Delete a single pod using a pod-specific variant. Namespace is required. " +
    'The "mode" selects the behavior: "evict" requests a graceful eviction that honors any matching ' +
    'PodDisruptionBudget (prefer this for draining or voluntary disruptions); "force_delete" deletes the pod ' +
    "immediately with a zero grace period (use for pods stuck on an unreachable or NotReady node); " +
    '"delete_with_finalizers" deletes the pod and clears its finalizers (last resort for a pod stuck in Terminating). ' +
    "For a plain pod delete, use deleteKubernetesResource instead.",
  parameters: Type.Object({
    name: Type.String({ description: "The name of the pod to delete" }),
    namespace: Type.String({ description: "The namespace of the pod" }),
    mode: literals(POD_DELETE_MODES, {
      description:
        '"evict": graceful eviction honoring PodDisruptionBudgets. ' +
        '"force_delete": immediate delete with grace period 0 for pods stuck on an unreachable node. ' +
        '"delete_with_finalizers": delete and clear finalizers to unstick a pod in Terminating (last resort).',
    }),
  }),
  mutating: true,
  requiresApprovalByDefault: true,
};

export const restartKubernetesResourceTool: AgentToolDefinition = {
  name: "restartKubernetesResource",
  label: "Restart workload",
  description:
    'Trigger a rollout restart of a workload (rolls its pods without deleting them directly), like "kubectl rollout ' +
    `restart". Namespace is required. Supported kinds: ${RESTARTABLE_KINDS.join(", ")}.`,
  parameters: Type.Object({
    kind: literals(RESTARTABLE_KINDS, { description: "The workload kind to restart." }),
    name: Type.String({ description: "The name of the workload to restart" }),
    namespace: Type.String({ description: "The namespace of the workload" }),
  }),
  mutating: true,
  requiresApprovalByDefault: true,
};
