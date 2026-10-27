import {
  createKubernetesResourceTool,
  deleteKubernetesResourceTool,
  deletePodTool,
  patchKubernetesResourceTool,
  restartKubernetesResourceTool,
  updateKubernetesResourceTool,
} from "../../../common/agent-tools";
import {
  DEFAULT_DELETE_MODE,
  type DeleteMode,
  type Manifest,
  type PodDeleteMode,
  type RestartableKind,
  resolveApiVersion,
} from "../../../common/agent-tools/resource-handlers";

import type { ClusterTool } from "./tool-runner";

// The cluster frame's tools: the write tools, until they run in main as the
// read tools do. They reach the cluster only through `Cluster`, so they can be
// tested with fakes; freelens-cluster.ts implements it on the Freelens renderer
// API. They run only after main's approval gate has validated and prepared
// their input, so they apply it as it comes.

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
  get(name: string, namespace?: string): Promise<ClusterResource | undefined>;
  create(name: string, namespace: string | undefined, manifest: Manifest): Promise<void>;
  /** Replaces the resource (PUT). */
  update(name: string, namespace: string | undefined, manifest: Manifest): Promise<void>;
  /** A JSON merge patch, or a strategic merge patch of `subresource` when given. */
  patch(name: string, namespace: string | undefined, data: Manifest, subresource?: string): Promise<void>;
  remove(name: string, namespace: string | undefined, mode: DeleteMode): Promise<void>;
}

export interface Cluster {
  /** The API serving `kind` at `apiVersion`, found through the cluster's API discovery, or an error text. */
  getResourceApi(kind: string, apiVersion: string): ResourceApi | string;
  deletePod(name: string, namespace: string, mode: PodDeleteMode): Promise<void>;
  restartWorkload(kind: RestartableKind, name: string, namespace: string): Promise<void>;
}

function resolveResourceApi(cluster: Cluster, kind: string, apiVersion?: string): ResourceApi | string {
  const version = resolveApiVersion(kind, apiVersion);
  if (!version) {
    return `Could not resolve the apiVersion for kind "${kind}". Provide an explicit apiVersion (for example "apps/v1").`;
  }
  return cluster.getResourceApi(kind, version);
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
  if (api.namespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to create "${name}".`;
  }
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

/**
 * The frame's tools by name. The runner checks each call's arguments against
 * the shared schema first, so the casts below only narrow validated input.
 */
export function createClusterTools(cluster: Cluster): Record<string, ClusterTool> {
  const tools: ClusterTool[] = [
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
