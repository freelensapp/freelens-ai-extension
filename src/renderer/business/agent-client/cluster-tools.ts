import {
  getClusterVersionTool,
  getKubernetesResourceTool,
  getNamespacesTool,
  getWarningEventsByNamespaceTool,
  listKubernetesResourcesTool,
} from "../../../common/agent-tools";
import { buildFieldSelector, type FieldSelector } from "../../../common/agent-tools/field-filter";
import { stripManagedFields } from "../../../common/agent-tools/project-resource";
import { type KubernetesVersionInfo, summarizeClusterVersion } from "../../../common/agent-tools/version-summary";
import { resolveApiVersion } from "../agent/tools/resource-handlers";

import type { ClusterTool } from "./tool-runner";

// The cluster frame's read tools. They reach the cluster only through
// `ClusterReader`, so they can be tested with fakes; freelens-cluster.ts
// implements it on the Freelens renderer API.

/** A Kubernetes object as the tools see it. */
export interface ClusterResource {
  name: string;
  namespace?: string;
  metadata?: object;
  spec?: unknown;
  status?: unknown;
}

export interface ResourceApi {
  namespaced: boolean;
  /** Every resource, or only those in `namespace` when given. */
  list(namespace?: string): Promise<ClusterResource[]>;
  get(name: string, namespace?: string): Promise<ClusterResource | undefined>;
}

export interface ClusterEvent {
  type?: string;
  message?: string;
  reason?: string;
  action?: string;
  involvedObject?: unknown;
  source?: unknown;
}

export interface ClusterReader {
  getVersionInfo(): Promise<KubernetesVersionInfo | undefined>;
  getNamespaceNames(): string[];
  getEvents(namespace: string): Promise<ClusterEvent[]>;
  /** The API serving `kind` at `apiVersion`, found through the cluster's API discovery, or an error text. */
  getResourceApi(kind: string, apiVersion: string): ResourceApi | string;
}

export interface ListResourceInput {
  kind: string;
  apiVersion?: string;
  namespace?: string;
  includeManagedFields?: boolean;
  fields?: string[];
}

export interface GetResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  includeManagedFields?: boolean;
  fields?: string[];
}

function resolveResourceApi(cluster: ClusterReader, kind: string, apiVersion?: string): ResourceApi | string {
  const version = resolveApiVersion(kind, apiVersion);
  if (!version) {
    return `Could not resolve the apiVersion for kind "${kind}". Provide an explicit apiVersion (for example "apps/v1").`;
  }
  return cluster.getResourceApi(kind, version);
}

function project({ name, namespace, spec, status, metadata }: ClusterResource, includeManagedFields = false) {
  return { name, namespace, spec, status, metadata: stripManagedFields(metadata, includeManagedFields) };
}

/** The field selector for `fields`, or the parse error text for a malformed one. */
function fieldSelector(fields?: string[]): FieldSelector | null | string {
  try {
    return buildFieldSelector(fields);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function getClusterVersion(cluster: ClusterReader): Promise<string> {
  const info = await cluster.getVersionInfo();
  if (!info || typeof info !== "object") {
    return "Could not determine the Kubernetes cluster version.";
  }
  return JSON.stringify(summarizeClusterVersion(info));
}

export function getNamespaces(cluster: ClusterReader): string {
  return JSON.stringify(cluster.getNamespaceNames());
}

export async function getWarningEventsByNamespace(
  cluster: ClusterReader,
  { namespace }: { namespace: string },
): Promise<string> {
  const events = await cluster.getEvents(namespace);
  return JSON.stringify(
    events
      .filter((event) => event.type === "Warning")
      .map(({ type, message, reason, action, involvedObject, source }) => ({
        event: { type, message, reason, action, involvedObject, source },
      })),
  );
}

export async function listKubernetesResources(
  cluster: ClusterReader,
  { kind, apiVersion, namespace, includeManagedFields, fields }: ListResourceInput,
): Promise<string> {
  const api = resolveResourceApi(cluster, kind, apiVersion);
  if (typeof api === "string") return api;
  const select = fieldSelector(fields);
  if (typeof select === "string") return select;
  const items = await api.list(api.namespaced ? namespace : undefined);
  const projected = items.map((item) => project(item, includeManagedFields));
  return JSON.stringify(select ? projected.map(select) : projected);
}

export async function getKubernetesResource(
  cluster: ClusterReader,
  { kind, apiVersion, name, namespace, includeManagedFields, fields }: GetResourceInput,
): Promise<string> {
  const api = resolveResourceApi(cluster, kind, apiVersion);
  if (typeof api === "string") return api;
  if (api.namespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to get "${name}".`;
  }
  const select = fieldSelector(fields);
  if (typeof select === "string") return select;
  const object = await api.get(name, api.namespaced ? namespace : undefined);
  if (!object) {
    return `The ${kind} "${name}" was not found.`;
  }
  const projected = project(object, includeManagedFields);
  return JSON.stringify(select ? select(projected) : projected);
}

/**
 * The frame's tools by name. The runner checks each call's arguments against
 * the shared schema first, so the casts below only narrow validated input.
 */
export function createClusterTools(cluster: ClusterReader): Record<string, ClusterTool> {
  const tools: ClusterTool[] = [
    { definition: getClusterVersionTool, run: () => getClusterVersion(cluster) },
    { definition: getNamespacesTool, run: () => getNamespaces(cluster) },
    {
      definition: getWarningEventsByNamespaceTool,
      run: (args) => getWarningEventsByNamespace(cluster, args as { namespace: string }),
    },
    {
      definition: listKubernetesResourcesTool,
      run: (args) => listKubernetesResources(cluster, args as unknown as ListResourceInput),
    },
    {
      definition: getKubernetesResourceTool,
      run: (args) => getKubernetesResource(cluster, args as unknown as GetResourceInput),
    },
  ];
  return Object.fromEntries(tools.map((tool) => [tool.definition.name, tool]));
}
