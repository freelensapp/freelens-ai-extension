// The write tools, run in main on the host's JSON client of the chat's cluster
// after the approval gate has validated and prepared their input. They send
// what the host's KubeApi sends for the same change, by path.

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
} from "../../../common/agent-tools/resource-handlers";
import {
  type ClusterToolContext,
  type ClusterToolRunner,
  POD_RESOURCE,
  type RawObject,
  resolveResource,
} from "./cluster-api";
import { describeRequestError } from "./describe-request-error";
import { type ResolvedResource, resourcePath } from "./resource-paths";

interface CreateResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  data: Manifest;
}

interface WriteResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  data: Manifest;
  subresource?: string;
}

interface DeleteResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  mode?: DeleteMode;
}

interface DeletePodInput {
  name: string;
  namespace: string;
  mode: PodDeleteMode;
}

interface RestartResourceInput {
  kind: RestartableKind;
  name: string;
  namespace: string;
}

// The content types of the patch strategies, as the host's KubeApi sends them.
const MERGE_PATCH_CONTENT_TYPE = "application/merge-patch+json";
// Subresource patches such as an in-place Pod resize merge array entries by
// their `name` key, which needs a strategic merge patch.
const STRATEGIC_MERGE_PATCH_CONTENT_TYPE = "application/strategic-merge-patch+json";

// The request bodies are free-form manifests, which the host types as a deep
// partial of its own object data.
type RequestData = NonNullable<NonNullable<Parameters<ClusterToolContext["api"]["post"]>[1]>["data"]>;
type PatchData = NonNullable<NonNullable<Parameters<ClusterToolContext["api"]["patch"]>[1]>["data"]>;
const asRequestData = (data: unknown) => data as RequestData;

const patchObject = (
  { api, signal }: ClusterToolContext,
  path: string,
  data: unknown,
  contentType: string,
): Promise<unknown> =>
  api.patch(path, { data: data as PatchData }, { headers: { "content-type": contentType }, signal });

// The manifest as the host's KubeApi sends it for a create or an update: the
// kind, the apiVersion, the name and the namespace of a namespaced kind set.
const withIdentity = (manifest: Manifest, resource: ResolvedResource, name: string, namespace?: string): Manifest => {
  const metadata = typeof manifest.metadata === "object" && manifest.metadata !== null ? manifest.metadata : {};
  return {
    ...manifest,
    kind: resource.kind,
    apiVersion: resource.apiVersion,
    metadata: { ...metadata, name, ...(namespace ? { namespace } : {}) },
  };
};

async function createKubernetesResource(
  context: ClusterToolContext,
  { kind, apiVersion, name, namespace, data }: CreateResourceInput,
): Promise<string> {
  const resource = await resolveResource(context, kind, apiVersion);
  if (typeof resource === "string") return resource;
  if (resource.namespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to create "${name}".`;
  }
  const scoped = resource.namespaced ? namespace : undefined;
  await context.api.post(
    resourcePath(resource, { namespace: scoped }),
    { data: asRequestData(withIdentity(data, resource, name, scoped)) },
    { signal: context.signal },
  );
  return `${kind} "${name}" created successfully`;
}

// A delete with the propagation policy the host's KubeApi uses, and the delete
// options of a force delete when asked for. Answers what the cluster answered:
// the object while it still exists, or a Status.
const deleteObject = ({ api, signal }: ClusterToolContext, path: string, force: boolean): Promise<unknown> =>
  api.del(
    path,
    {
      query: { propagationPolicy: "Background" },
      ...(force
        ? {
            data: asRequestData({
              kind: "DeleteOptions",
              apiVersion: "v1",
              gracePeriodSeconds: 0,
              propagationPolicy: "Background",
            }),
          }
        : {}),
    },
    { signal },
  );

// The resource and the scoped namespace of an existing object, or the text for
// the model when the kind is not served or the namespace is missing.
async function existingObject(
  context: ClusterToolContext,
  verb: string,
  { kind, apiVersion, name, namespace }: { kind: string; apiVersion?: string; name: string; namespace?: string },
): Promise<{ resource: ResolvedResource; path: string; namespace?: string } | string> {
  const resource = await resolveResource(context, kind, apiVersion);
  if (typeof resource === "string") return resource;
  if (resource.namespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to ${verb} "${name}".`;
  }
  const scoped = resource.namespaced ? namespace : undefined;
  return { resource, path: resourcePath(resource, { name, namespace: scoped }), namespace: scoped };
}

async function updateKubernetesResource(context: ClusterToolContext, input: WriteResourceInput): Promise<string> {
  const target = await existingObject(context, "update", input);
  if (typeof target === "string") return target;
  const { resource, path, namespace } = target;
  const body = withIdentity(input.data, resource, input.name, namespace);
  await context.api.put(path, { data: asRequestData(body) }, { signal: context.signal });
  return `${input.kind} "${input.name}" updated successfully`;
}

async function patchKubernetesResource(context: ClusterToolContext, input: WriteResourceInput): Promise<string> {
  const target = await existingObject(context, "patch", input);
  if (typeof target === "string") return target;
  if (input.subresource) {
    await patchObject(context, `${target.path}/${input.subresource}`, input.data, STRATEGIC_MERGE_PATCH_CONTENT_TYPE);
    return `${input.kind} "${input.name}" ${input.subresource} subresource patched successfully`;
  }
  await patchObject(context, target.path, input.data, MERGE_PATCH_CONTENT_TYPE);
  return `${input.kind} "${input.name}" patched successfully`;
}

async function deleteKubernetesResource(context: ClusterToolContext, input: DeleteResourceInput): Promise<string> {
  const mode = input.mode ?? DEFAULT_DELETE_MODE;
  const target = await existingObject(context, "delete", input);
  if (typeof target === "string") return target;
  if (mode === "force_finalize") {
    await patchObject(context, target.path, { metadata: { finalizers: [] } }, MERGE_PATCH_CONTENT_TYPE);
    return `${input.kind} "${input.name}" finalizers cleared successfully`;
  }
  await deleteObject(context, target.path, mode === "force_delete");
  return `${input.kind} "${input.name}" ${mode === "force_delete" ? "force-" : ""}deleted successfully`;
}

// The finalizers an answer of the cluster still lists: none for a Status.
const finalizersIn = (answer: unknown): string[] => {
  const finalizers = (answer as RawObject | undefined)?.metadata?.finalizers;
  return Array.isArray(finalizers) ? finalizers : [];
};

// Clears the finalizers with a JSON merge patch setting them to null (a
// strategic merge patch with an empty list leaves them in place), then force
// deletes the pod, as the host's `deleteWithFinalizers` means to. The result
// says what the cluster answered to each step.
async function deletePodWithFinalizers(context: ClusterToolContext, name: string, path: string): Promise<string> {
  let patchOutcome: string | undefined;
  try {
    const patched = await patchObject(context, path, { metadata: { finalizers: null } }, MERGE_PATCH_CONTENT_TYPE);
    const kept = finalizersIn(patched);
    if (kept.length > 0) patchOutcome = `The cluster kept the finalizers of Pod "${name}": ${kept.join(", ")}.`;
  } catch (error) {
    if (context.signal?.aborted) throw error;
    // As the host does: the force delete still runs.
    patchOutcome = `Clearing the finalizers of Pod "${name}" failed: ${describeRequestError(error)}.`;
  }

  let deleted: unknown;
  try {
    deleted = await deleteObject(context, path, true);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    const before = patchOutcome ?? `The finalizers of Pod "${name}" were cleared.`;
    throw new Error(`${before} Deleting it failed: ${describeRequestError(error)}`);
  }
  const remaining = finalizersIn(deleted);
  if (remaining.length === 0 && !patchOutcome) return `Pod "${name}" deleted and finalizers cleared successfully`;
  const deleteOutcome =
    remaining.length > 0
      ? `Pod "${name}" is marked for deletion but still has the finalizers ${remaining.join(", ")}, so it stays until they are removed.`
      : `Pod "${name}" was force-deleted.`;
  return patchOutcome ? `${patchOutcome} ${deleteOutcome}` : deleteOutcome;
}

async function deletePod(context: ClusterToolContext, { name, namespace, mode }: DeletePodInput): Promise<string> {
  const path = resourcePath(POD_RESOURCE, { name, namespace });
  switch (mode) {
    case "evict":
      await context.api.post(
        `${path}/eviction`,
        { data: asRequestData({ apiVersion: "policy/v1", kind: "Eviction", metadata: { name, namespace } }) },
        { signal: context.signal },
      );
      return `Pod "${name}" evicted successfully`;
    case "force_delete":
      await deleteObject(context, path, true);
      return `Pod "${name}" force-deleted successfully`;
    case "delete_with_finalizers":
      return deletePodWithFinalizers(context, name, path);
  }
}

// A rollout restart, as the host's `restart()` of deployments, daemon sets and
// stateful sets does it: the pod template's `restartedAt` annotation set to now.
async function restartKubernetesResource(
  context: ClusterToolContext,
  { kind, name, namespace }: RestartResourceInput,
): Promise<string> {
  const target = await existingObject(context, "restart", { kind, apiVersion: "apps/v1", name, namespace });
  if (typeof target === "string") return target;
  const restartedAt = new Date().toISOString();
  await patchObject(
    context,
    target.path,
    { spec: { template: { metadata: { annotations: { "kubectl.kubernetes.io/restartedAt": restartedAt } } } } },
    STRATEGIC_MERGE_PATCH_CONTENT_TYPE,
  );
  return `${kind} "${name}" restarted successfully`;
}

/** The write tools by name. pi checks each call's arguments against the shared schema first. */
export const WRITE_TOOL_RUNNERS: Readonly<Record<string, ClusterToolRunner>> = {
  [createKubernetesResourceTool.name]: (args, context) =>
    createKubernetesResource(context, args as unknown as CreateResourceInput),
  [updateKubernetesResourceTool.name]: (args, context) =>
    updateKubernetesResource(context, args as unknown as WriteResourceInput),
  [patchKubernetesResourceTool.name]: (args, context) =>
    patchKubernetesResource(context, args as unknown as WriteResourceInput),
  [deleteKubernetesResourceTool.name]: (args, context) =>
    deleteKubernetesResource(context, args as unknown as DeleteResourceInput),
  [deletePodTool.name]: (args, context) => deletePod(context, args as unknown as DeletePodInput),
  [restartKubernetesResourceTool.name]: (args, context) =>
    restartKubernetesResource(context, args as unknown as RestartResourceInput),
};
