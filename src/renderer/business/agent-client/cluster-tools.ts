import {
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
} from "../../../common/agent-tools";
import { buildFieldSelector, type FieldSelector } from "../../../common/agent-tools/field-filter";
import {
  capLogOutput,
  capTailLines,
  collectContainerNames,
  compileLogFilter,
  emptyLogsMessage,
  filterLogLines,
  type GetPodLogsInput,
  isPreviousContainerNotFoundError,
  noMatchingLogsMessage,
  resolveContainer,
} from "../../../common/agent-tools/pod-logs";
import { stripManagedFields } from "../../../common/agent-tools/project-resource";
import {
  DEFAULT_DELETE_MODE,
  type DeleteMode,
  type Manifest,
  type PodDeleteMode,
  type RestartableKind,
  resolveApiVersion,
} from "../../../common/agent-tools/resource-handlers";
import { type KubernetesVersionInfo, summarizeClusterVersion } from "../../../common/agent-tools/version-summary";

import type { ClusterTool } from "./tool-runner";

// The cluster frame's tools. They reach the cluster only through `Cluster`, so
// they can be tested with fakes; freelens-cluster.ts implements it on the
// Freelens renderer API. The write tools run only after main's approval gate
// has validated and prepared their input, so they apply it as it comes.

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
  create(name: string, namespace: string | undefined, manifest: Manifest): Promise<void>;
  /** Replaces the resource (PUT). */
  update(name: string, namespace: string | undefined, manifest: Manifest): Promise<void>;
  /** A JSON merge patch, or a strategic merge patch of `subresource` when given. */
  patch(name: string, namespace: string | undefined, data: Manifest, subresource?: string): Promise<void>;
  remove(name: string, namespace: string | undefined, mode: DeleteMode): Promise<void>;
}

export interface PodLogsQuery {
  container: string;
  tailLines: number;
  timestamps?: boolean;
  previous?: boolean;
}

export interface ClusterEvent {
  type?: string;
  message?: string;
  reason?: string;
  action?: string;
  involvedObject?: unknown;
  source?: unknown;
}

export interface Cluster {
  getVersionInfo(): Promise<KubernetesVersionInfo | undefined>;
  getNamespaceNames(): string[];
  getEvents(namespace: string): Promise<ClusterEvent[]>;
  /** The API serving `kind` at `apiVersion`, found through the cluster's API discovery, or an error text. */
  getResourceApi(kind: string, apiVersion: string): ResourceApi | string;
  deletePod(name: string, namespace: string, mode: PodDeleteMode): Promise<void>;
  restartWorkload(kind: RestartableKind, name: string, namespace: string): Promise<void>;
  getPodLogs(name: string, namespace: string, query: PodLogsQuery): Promise<string>;
  /** The "pod logs tail lines" preference. */
  podLogsTailLines(): number;
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

function resolveResourceApi(cluster: Cluster, kind: string, apiVersion?: string): ResourceApi | string {
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

export async function getClusterVersion(cluster: Cluster): Promise<string> {
  const info = await cluster.getVersionInfo();
  if (!info || typeof info !== "object") {
    return "Could not determine the Kubernetes cluster version.";
  }
  return JSON.stringify(summarizeClusterVersion(info));
}

export function getNamespaces(cluster: Cluster): string {
  return JSON.stringify(cluster.getNamespaceNames());
}

export async function getWarningEventsByNamespace(
  cluster: Cluster,
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
  cluster: Cluster,
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
  cluster: Cluster,
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

export interface CreateResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  data: Manifest;
}

export interface WriteResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  data: Manifest;
  subresource?: string;
}

export interface DeleteResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  mode?: DeleteMode;
}

// Resolves the API of an existing resource for update, patch and delete.
async function existingResource(
  cluster: Cluster,
  verb: string,
  { kind, apiVersion, name, namespace }: { kind: string; apiVersion?: string; name: string; namespace?: string },
): Promise<{ api: ResourceApi; namespace?: string } | string> {
  const api = resolveResourceApi(cluster, kind, apiVersion);
  if (typeof api === "string") return api;
  if (api.namespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to ${verb} "${name}".`;
  }
  const scoped = api.namespaced ? namespace : undefined;
  if (!(await api.get(name, scoped))) {
    return `The ${kind} "${name}" you want to ${verb} does not exist`;
  }
  return { api, namespace: scoped };
}

export async function createKubernetesResource(
  cluster: Cluster,
  { kind, apiVersion, name, namespace, data }: CreateResourceInput,
): Promise<string> {
  const api = resolveResourceApi(cluster, kind, apiVersion);
  if (typeof api === "string") return api;
  await api.create(name, api.namespaced ? namespace : undefined, data);
  return `${kind} "${name}" created successfully`;
}

export async function updateKubernetesResource(cluster: Cluster, input: WriteResourceInput): Promise<string> {
  const target = await existingResource(cluster, "update", input);
  if (typeof target === "string") return target;
  await target.api.update(input.name, target.namespace, input.data);
  return `${input.kind} "${input.name}" updated successfully`;
}

export async function patchKubernetesResource(cluster: Cluster, input: WriteResourceInput): Promise<string> {
  const target = await existingResource(cluster, "patch", input);
  if (typeof target === "string") return target;
  await target.api.patch(input.name, target.namespace, input.data, input.subresource);
  return input.subresource
    ? `${input.kind} "${input.name}" ${input.subresource} subresource patched successfully`
    : `${input.kind} "${input.name}" patched successfully`;
}

export async function deleteKubernetesResource(cluster: Cluster, input: DeleteResourceInput): Promise<string> {
  const mode = input.mode ?? DEFAULT_DELETE_MODE;
  const target = await existingResource(cluster, "delete", input);
  if (typeof target === "string") return target;
  await target.api.remove(input.name, target.namespace, mode);
  if (mode === "force_finalize") return `${input.kind} "${input.name}" finalizers cleared successfully`;
  return `${input.kind} "${input.name}" ${mode === "force_delete" ? "force-" : ""}deleted successfully`;
}

const POD_DELETE_RESULTS: Record<PodDeleteMode, string> = {
  evict: "evicted successfully",
  force_delete: "force-deleted successfully",
  delete_with_finalizers: "deleted and finalizers cleared successfully",
};

export async function deletePod(
  cluster: Cluster,
  { name, namespace, mode }: { name: string; namespace: string; mode: PodDeleteMode },
): Promise<string> {
  await cluster.deletePod(name, namespace, mode);
  return `Pod "${name}" ${POD_DELETE_RESULTS[mode]}`;
}

export async function restartKubernetesResource(
  cluster: Cluster,
  { kind, name, namespace }: { kind: RestartableKind; name: string; namespace: string },
): Promise<string> {
  await cluster.restartWorkload(kind, name, namespace);
  return `${kind} "${name}" restarted successfully`;
}

/** Reads a capped, optionally filtered snapshot of a container's logs. */
export async function getPodLogs(cluster: Cluster, input: GetPodLogsInput): Promise<string> {
  const { name, namespace, container, previous, timestamps } = input;
  // An invalid expression is reported before anything is loaded.
  const filter = compileLogFilter(input.filter);
  if (filter.kind === "error") return filter.message;

  const pods = cluster.getResourceApi("Pod", "v1");
  if (typeof pods === "string") return pods;
  const pod = await pods.get(name, namespace);
  if (!pod) return `The Pod "${name}" was not found in namespace "${namespace}".`;

  const resolution = resolveContainer(container, collectContainerNames(pod.spec));
  if (resolution.kind !== "resolved") return resolution.message;
  const selected = resolution.container;

  let logs: string;
  try {
    logs = await cluster.getPodLogs(name, namespace, {
      container: selected,
      tailLines: capTailLines(input.tailLines, cluster.podLogsTailLines()),
      timestamps,
      previous,
    });
  } catch (error) {
    // Expected when previous: true is asked for a container that never terminated.
    if (isPreviousContainerNotFoundError(error)) return emptyLogsMessage(selected, name, previous);
    throw error;
  }
  if (!logs || logs.trim().length === 0) return emptyLogsMessage(selected, name, previous);
  if (filter.kind === "regex") {
    const filtered = filterLogLines(logs, filter.regex);
    if (filtered.trim().length === 0) return noMatchingLogsMessage(selected, name, input.filter as string);
    return capLogOutput(filtered);
  }
  return capLogOutput(logs);
}

/**
 * The frame's tools by name. The runner checks each call's arguments against
 * the shared schema first, so the casts below only narrow validated input.
 */
export function createClusterTools(cluster: Cluster): Record<string, ClusterTool> {
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
    { definition: getPodLogsTool, run: (args) => getPodLogs(cluster, args as unknown as GetPodLogsInput) },
    {
      definition: createKubernetesResourceTool,
      run: (args) => createKubernetesResource(cluster, args as unknown as CreateResourceInput),
    },
    {
      definition: updateKubernetesResourceTool,
      run: (args) => updateKubernetesResource(cluster, args as unknown as WriteResourceInput),
    },
    {
      definition: patchKubernetesResourceTool,
      run: (args) => patchKubernetesResource(cluster, args as unknown as WriteResourceInput),
    },
    {
      definition: deleteKubernetesResourceTool,
      run: (args) => deleteKubernetesResource(cluster, args as unknown as DeleteResourceInput),
    },
    {
      definition: deletePodTool,
      run: (args) => deletePod(cluster, args as { name: string; namespace: string; mode: PodDeleteMode }),
    },
    {
      definition: restartKubernetesResourceTool,
      run: (args) =>
        restartKubernetesResource(cluster, args as { kind: RestartableKind; name: string; namespace: string }),
    },
  ];
  return Object.fromEntries(tools.map((tool) => [tool.definition.name, tool]));
}
