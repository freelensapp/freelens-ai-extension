import { Type } from "typebox";

import type { AgentToolDefinition } from "./index";

// Schemas shared by the resource tools. The write tools (ticket 05) reuse them.

export const kindSchema = Type.String({
  description:
    "The Kubernetes resource kind, e.g. Pod, Deployment, Service or a CRD kind such as Gateway. " +
    "Kinds are looked up in the cluster's API discovery, so any kind the cluster serves works.",
});

export const apiVersionSchema = Type.Optional(
  Type.String({
    description:
      'The apiVersion (group/version) of the resource, e.g. "v1", "apps/v1" or "gateway.networking.k8s.io/v1". ' +
      "Pod, Deployment and Service default it; every other kind, including CRDs, needs it.",
  }),
);

export const includeManagedFieldsSchema = Type.Optional(
  Type.Boolean({
    description:
      "Whether to include metadata.managedFields in the output. Defaults to false: the server-side apply " +
      "bookkeeping is large and irrelevant for analysis, so it is stripped to save context. Set to true only " +
      "when you specifically need to inspect field ownership.",
  }),
);

export const fieldsSchema = Type.Optional(
  Type.Array(Type.String(), {
    description:
      "Optional list of JSONPath-style field selectors (the kubectl `-o jsonpath` subset) applied to each " +
      "returned resource to trim the output to only the fields you need, instead of the full and often verbose " +
      "object. Each selector is relative to a single resource and the result keeps the nested structure of the " +
      'matched fields. Examples: ".metadata.name", ".status.phase", ".spec.containers[*].image", ' +
      '".metadata.labels[\'app.kubernetes.io/name\']", ".spec.containers[0].name". ' +
      "Omit to return the full resource.",
  }),
);

export const listKubernetesResourcesTool: AgentToolDefinition = {
  name: "listKubernetesResources",
  label: "List resources",
  description:
    "List Kubernetes resources of a given kind, optionally scoped to a namespace. " +
    "metadata.managedFields is stripped by default to keep the output small. " +
    'Pass "fields" with JSONPath-style selectors (e.g. [".metadata.name", ".status.phase"]) to return only ' +
    "a subset of each resource instead of the full, verbose object; prefer this when listing many resources.",
  parameters: Type.Object({
    kind: kindSchema,
    apiVersion: apiVersionSchema,
    namespace: Type.Optional(
      Type.String({ description: "The namespace to list namespaced resources in. Omit to list all namespaces." }),
    ),
    includeManagedFields: includeManagedFieldsSchema,
    fields: fieldsSchema,
  }),
  mutating: false,
  requiresApprovalByDefault: false,
};

export const getKubernetesResourceTool: AgentToolDefinition = {
  name: "getKubernetesResource",
  label: "Get resource",
  description:
    "Get a single Kubernetes resource by name (namespace required for namespaced kinds). " +
    "metadata.managedFields is stripped by default to keep the output small. " +
    'Pass "fields" with JSONPath-style selectors (e.g. [".status.phase", ".spec.containers[*].image"]) to ' +
    "return only a subset of the resource instead of the full, verbose object.",
  parameters: Type.Object({
    kind: kindSchema,
    apiVersion: apiVersionSchema,
    name: Type.String({ description: "The name of the resource" }),
    namespace: Type.Optional(
      Type.String({ description: "The namespace of the resource (required for namespaced kinds)" }),
    ),
    includeManagedFields: includeManagedFieldsSchema,
    fields: fieldsSchema,
  }),
  mutating: false,
  requiresApprovalByDefault: false,
};
