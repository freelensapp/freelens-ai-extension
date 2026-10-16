import { interrupt } from "@langchain/langgraph";
import { stringify as stringifyYaml } from "yaml";
import { PreferencesStore } from "../../../common/store";
import { clusterApiFor, type KubeJsonApi } from "./cluster-api";
import { type KubernetesVersionInfo, summarizeClusterVersion } from "./cluster-version";
import { buildFieldSelector } from "./field-filter";
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
} from "./pod-logs";
import { stripManagedFields } from "./project-resource";
import {
  DEFAULT_DELETE_MODE,
  type DeleteMode,
  isRestartableKind,
  type Manifest,
  normalizeSubresource,
  type PodDeleteMode,
  prepareManifest,
  RESTARTABLE_KINDS,
  resolveApiVersion,
  validateManifest,
} from "./resource-handlers";
import {
  type ApiResourceList,
  findApiResource,
  groupVersionPath,
  type ResolvedResource,
  resourcePath,
} from "./resource-paths";

import type { RunnableConfig } from "@langchain/core/runnables";

// A Kubernetes object as the API server returns it.
interface RawObject {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string; [key: string]: unknown };
  spec?: unknown;
  status?: unknown;
}

interface RawList {
  items?: RawObject[];
}

interface ResolvedTarget {
  api: KubeJsonApi;
  resource: ResolvedResource;
}

export interface ListResourceInput {
  kind: string;
  apiVersion?: string;
  namespace?: string;
  // Server-side apply bookkeeping (`metadata.managedFields`) is stripped by
  // default to keep the output small; set this to opt back in when needed.
  includeManagedFields?: boolean;
  // Optional JSONPath-style field selectors (the kubectl `-o jsonpath` subset)
  // applied to each resource to trim the output to just the requested fields.
  fields?: string[];
}

export interface GetResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  // See ListResourceInput.includeManagedFields.
  includeManagedFields?: boolean;
  // See ListResourceInput.fields.
  fields?: string[];
}

export interface CreateResourceInput {
  kind: string;
  apiVersion?: string;
  name?: string;
  namespace?: string;
  data: Manifest;
}

export interface WriteResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  data: Manifest;
  // Only consumed by patchKubernetesResource: the subresource to patch instead
  // of the main resource (for example "resize" to change a running Pod's
  // CPU/memory in place, or "scale").
  subresource?: string;
}

export interface DeleteResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  mode?: DeleteMode;
}

export interface DeletePodInput {
  name: string;
  namespace: string;
  mode: PodDeleteMode;
}

export interface RestartResourceInput {
  kind: string;
  name: string;
  namespace: string;
}

// The content types of the patch strategies, as the host's KubeApi sends them.
const MERGE_PATCH_CONTENT_TYPE = "application/merge-patch+json";
// Subresource patches such as in-place Pod resize update entries inside arrays
// (spec.containers) that are merged by their `name` key, so a strategic merge
// is required; a plain JSON merge patch would replace the whole array.
const STRATEGIC_MERGE_PATCH_CONTENT_TYPE = "application/strategic-merge-patch+json";

const POD: ResolvedResource = { kind: "Pod", apiVersion: "v1", plural: "pods", namespaced: true };

// The request bodies are free-form manifests, which the host types as a deep
// partial of its own object data. Go through `unknown` to the exact parameter
// type rather than using `as any`.
type RequestData = NonNullable<NonNullable<Parameters<KubeJsonApi["post"]>[1]>["data"]>;
type PatchData = NonNullable<NonNullable<Parameters<KubeJsonApi["patch"]>[1]>["data"]>;
const asRequestData = (data: unknown) => data as RequestData;
const asPatchData = (data: unknown) => data as PatchData;

const mergePatch = (api: KubeJsonApi, path: string, data: unknown, contentType = MERGE_PATCH_CONTENT_TYPE) =>
  api.patch(path, { data: asPatchData(data) }, { headers: { "content-type": contentType } });

// A delete with the propagation policy the host's KubeApi uses, and the delete
// options of a force delete when asked for.
const deleteObject = (api: KubeJsonApi, path: string, force: boolean) =>
  api.del(path, {
    query: { propagationPolicy: "Background" },
    data: force
      ? asRequestData({
          kind: "DeleteOptions",
          apiVersion: "v1",
          gracePeriodSeconds: 0,
          propagationPolicy: "Background",
        })
      : undefined,
  });

/**
 * Resolve the API path of a kind/apiVersion on the run's cluster from the API
 * server's discovery document. Returns a human-readable error string when
 * resolution is not possible so the model can react (for example by supplying
 * an explicit apiVersion for a CRD).
 */
async function resolveTarget(
  config: RunnableConfig | undefined,
  kind: string,
  apiVersion?: string,
): Promise<ResolvedTarget | string> {
  const api = clusterApiFor(config);
  if (typeof api === "string") {
    return api;
  }
  const version = resolveApiVersion(kind, apiVersion);
  if (!version) {
    return `Could not resolve the apiVersion for kind "${kind}". Provide an explicit apiVersion (for example "apps/v1").`;
  }
  let resource: ResolvedResource | undefined;
  try {
    resource = findApiResource(await api.get<ApiResourceList>(groupVersionPath(version)), kind, version);
  } catch (error) {
    console.error("[Tool invocation error: resolveTarget] - ", error);
  }
  if (!resource) {
    return `Could not resolve a Kubernetes API for kind "${kind}" and apiVersion "${version}".`;
  }
  return { api, resource };
}

/**
 * Run the human-in-the-loop approval gate for a write operation. When
 * `resourcesYaml` is provided it carries the current full YAML of the resources
 * the action will change, presented as a folded backup so the change can be
 * reverted.
 */
function requestApproval(action: string, payload: Record<string, unknown>, resourcesYaml?: string): boolean {
  const actionToApprove = { action, ...payload };
  // Render the payload as YAML, the native format of the Kubernetes world,
  // so the approval prompt is highlighted as YAML rather than JSON.
  const actionString = stringifyYaml(actionToApprove);
  const interruptRequest = {
    question: "Do you want to approve this action?",
    options: ["yes", "no"],
    actionToApprove,
    // Structured fields consumed by the Interrupt component to render foldable
    // "Action details" and "Resources that will be changed" sections.
    actionString,
    resourcesString: resourcesYaml,
    // Markdown fallback for renderers that do not understand the structured
    // fields (for example the MCP tool approval prompt).
    requestString: "```yaml\n" + actionString + "```",
  };
  const review = interrupt(interruptRequest);
  console.log("Tool call review: ", review);
  return review === "yes";
}

/**
 * Build a restorable manifest from a loaded object: the full resource as it
 * exists now, used as the backup presented before a destructive change.
 */
function toBackupManifest(object: RawObject) {
  return {
    apiVersion: object.apiVersion,
    kind: object.kind,
    metadata: object.metadata,
    spec: object.spec,
    status: object.status,
  };
}

/**
 * Best-effort capture of the current YAML of a resource before it is changed.
 * Returns `undefined` (rather than throwing) when the resource cannot be loaded,
 * so a missing backup never blocks the approval prompt.
 */
async function captureResourceYaml(
  api: KubeJsonApi,
  resource: ResolvedResource,
  name: string,
  namespace?: string,
): Promise<string | undefined> {
  try {
    const object = await api.get<RawObject>(resourcePath(resource, { name, namespace }));
    if (!object) {
      return undefined;
    }
    return stringifyYaml(toBackupManifest(object));
  } catch (error) {
    console.error("[Backup capture error] - ", error);
    return undefined;
  }
}

function projectObject(object: RawObject, includeManagedFields = false) {
  return {
    name: object.metadata?.name,
    namespace: object.metadata?.namespace,
    spec: object.spec,
    status: object.status,
    metadata: stripManagedFields(object.metadata, includeManagedFields),
  };
}

/**
 * List resources of a kind. Namespaced kinds are scoped to `namespace` when
 * provided; otherwise all namespaces are returned.
 */
export async function listKubernetesResources(
  { kind, apiVersion, namespace, includeManagedFields, fields }: ListResourceInput,
  config?: RunnableConfig,
): Promise<string> {
  console.log("[Tool invocation: listKubernetesResources] - kind:", kind, "namespace:", namespace);
  const target = await resolveTarget(config, kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  let select: ReturnType<typeof buildFieldSelector>;
  try {
    select = buildFieldSelector(fields);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const { api, resource } = target;
  try {
    const list = await api.get<RawList>(resourcePath(resource, { namespace }));
    const projected = (list.items ?? []).map((item) => projectObject(item, includeManagedFields));
    return JSON.stringify(select ? projected.map(select) : projected);
  } catch (error) {
    console.error("[Tool invocation error: listKubernetesResources] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Get a single resource by name. For namespaced kinds a namespace is required.
 */
export async function getKubernetesResource(
  { kind, apiVersion, name, namespace, includeManagedFields, fields }: GetResourceInput,
  config?: RunnableConfig,
): Promise<string> {
  console.log("[Tool invocation: getKubernetesResource] - kind:", kind, "name:", name, "namespace:", namespace);
  const target = await resolveTarget(config, kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { api, resource } = target;
  if (resource.namespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to get "${name}".`;
  }
  let select: ReturnType<typeof buildFieldSelector>;
  try {
    select = buildFieldSelector(fields);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  try {
    const object = await api.get<RawObject>(resourcePath(resource, { name, namespace }));
    if (!object) {
      return `The ${kind} "${name}" was not found.`;
    }
    const projected = projectObject(object, includeManagedFields);
    return JSON.stringify(select ? select(projected) : projected);
  } catch (error) {
    console.error("[Tool invocation error: getKubernetesResource] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Read the Kubernetes version of the run's cluster by querying the API server's
 * `/version` endpoint directly (the same `version.Info` that `kubectl version`
 * reports). This is the authoritative source for the server version and avoids
 * heuristics such as inspecting node `kubeletVersion`s.
 */
export async function getClusterVersion(_input: unknown, config?: RunnableConfig): Promise<string> {
  console.log("[Tool invocation: getClusterVersion]");
  const api = clusterApiFor(config);
  if (typeof api === "string") {
    return api;
  }
  try {
    const info = await api.get<KubernetesVersionInfo>("/version");
    if (!info || typeof info !== "object") {
      return "Could not determine the Kubernetes cluster version.";
    }
    const summary = summarizeClusterVersion(info);
    console.log("[Tool invocation result: getClusterVersion] - ", summary);
    return JSON.stringify(summary);
  } catch (error) {
    console.error("[Tool invocation error: getClusterVersion] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * The names of every namespace of the run's cluster.
 */
export async function getNamespaces(_input: unknown, config?: RunnableConfig): Promise<string[] | string> {
  console.log("[Tool invocation: getNamespaces]");
  const api = clusterApiFor(config);
  if (typeof api === "string") {
    return api;
  }
  try {
    const list = await api.get<RawList>("/api/v1/namespaces");
    const result = (list.items ?? []).map((item) => item.metadata?.name ?? "").filter((name) => name.length > 0);
    console.log("[Tool invocation result: getNamespaces] - ", result);
    return result;
  } catch (error) {
    console.error("[Tool invocation error: getNamespaces] - ", error);
    return JSON.stringify(error);
  }
}

interface RawEvent extends RawObject {
  type?: string;
  message?: string;
  reason?: string;
  action?: string;
  involvedObject?: unknown;
  source?: unknown;
}

/**
 * The events of type Warning in a namespace of the run's cluster.
 */
export async function getWarningEventsByNamespace(
  { namespace }: { namespace: string },
  config?: RunnableConfig,
): Promise<string> {
  console.log("[Tool invocation: getWarningEventsForNamespace] - namespace: ", namespace);
  const api = clusterApiFor(config);
  if (typeof api === "string") {
    return api;
  }
  try {
    const list = await api.get<{ items?: RawEvent[] }>(`/api/v1/namespaces/${encodeURIComponent(namespace)}/events`, {
      query: { fieldSelector: "type=Warning" },
    });
    const result = JSON.stringify(
      (list.items ?? [])
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
    console.log("[Tool invocation result: getWarningEventsForNamespace] - ", result);
    return result;
  } catch (error) {
    console.error("[Tool invocation error: getWarningEventsForNamespace] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Create a resource. Known kinds are validated and prepared via their handler;
 * unknown kinds (CRDs) are applied as free YAML/JSON.
 */
export async function createKubernetesResource(
  { kind, apiVersion, name, namespace, data }: CreateResourceInput,
  config?: RunnableConfig,
): Promise<string> {
  console.log("[Tool invocation: createKubernetesResource] - kind:", kind);
  const target = await resolveTarget(config, kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { api, resource } = target;

  const validation = validateManifest(kind, data);
  if (!validation.success) {
    return `The ${kind} manifest is invalid: ${validation.error}`;
  }
  const manifest = prepareManifest(kind, validation.data);
  const metadata = (manifest.metadata ?? {}) as { name?: string; namespace?: string };
  const resourceName = name ?? metadata.name;
  const resourceNamespace = namespace ?? metadata.namespace;
  if (!resourceName) {
    return `Could not determine the name for the ${kind} to create.`;
  }

  if (
    !requestApproval(`CREATE ${kind.toUpperCase()}`, {
      name: resourceName,
      namespace: resourceNamespace,
      data: manifest,
    })
  ) {
    return "The user denied the action";
  }

  try {
    // As the host's KubeApi creates: the kind, the apiVersion and the name
    // (and the namespace of a namespaced kind) set on the manifest.
    const body = {
      ...manifest,
      kind: resource.kind,
      apiVersion: resource.apiVersion,
      metadata: {
        ...metadata,
        name: resourceName,
        ...(resource.namespaced && resourceNamespace ? { namespace: resourceNamespace } : {}),
      },
    };
    const result = await api.post(resourcePath(resource, { namespace: resourceNamespace }), {
      data: asRequestData(body),
    });
    console.log("[Tool invocation result: createKubernetesResource] - ", result);
    return `${kind} manifest applied successfully`;
  } catch (error) {
    console.error("[Tool invocation error: createKubernetesResource] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Update a resource (maps to a PUT). Loads the existing object first, then
 * replaces it with the provided manifest.
 */
export async function updateKubernetesResource(
  { kind, apiVersion, name, namespace, data }: WriteResourceInput,
  config?: RunnableConfig,
): Promise<string> {
  console.log("[Tool invocation: updateKubernetesResource] - kind:", kind, "name:", name);
  const target = await resolveTarget(config, kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { api, resource } = target;
  if (resource.namespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to update "${name}".`;
  }

  const validation = validateManifest(kind, data);
  if (!validation.success) {
    return `The ${kind} manifest is invalid: ${validation.error}`;
  }
  const manifest = prepareManifest(kind, validation.data);

  const backup = await captureResourceYaml(api, resource, name, namespace);
  if (!requestApproval(`UPDATE ${kind.toUpperCase()}`, { name, namespace, data: manifest }, backup)) {
    return "The user denied the action";
  }

  try {
    const path = resourcePath(resource, { name, namespace });
    const item = await api.get<RawObject>(path);
    if (!item) {
      return `The ${kind} "${name}" you want to update does not exist`;
    }
    // As the host's KubeApi updates: the name and namespace set on the manifest.
    const body = {
      ...manifest,
      metadata: {
        ...((manifest.metadata ?? {}) as Record<string, unknown>),
        name,
        ...(resource.namespaced && namespace ? { namespace } : {}),
      },
    };
    const result = await api.put(path, { data: asRequestData(body) });
    console.log("[Tool invocation result: updateKubernetesResource] - ", result);
    return `${kind} updated successfully`;
  } catch (error) {
    console.error("[Tool invocation error: updateKubernetesResource] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Patch a resource (maps to a PATCH). Loads the existing object first, then
 * applies the provided partial manifest as a merge patch.
 */
export async function patchKubernetesResource(
  { kind, apiVersion, name, namespace, data, subresource }: WriteResourceInput,
  config?: RunnableConfig,
): Promise<string> {
  const normalizedSubresource = normalizeSubresource(subresource);
  console.log(
    "[Tool invocation: patchKubernetesResource] - kind:",
    kind,
    "name:",
    name,
    "subresource:",
    normalizedSubresource,
  );
  const target = await resolveTarget(config, kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { api, resource } = target;
  if (resource.namespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to patch "${name}".`;
  }

  const backup = await captureResourceYaml(api, resource, name, namespace);
  if (
    !requestApproval(
      `PATCH ${kind.toUpperCase()}`,
      { name, namespace, subresource: normalizedSubresource, data },
      backup,
    )
  ) {
    return "The user denied the action";
  }

  try {
    const path = resourcePath(resource, { name, namespace });
    const item = await api.get<RawObject>(path);
    if (!item) {
      return `The ${kind} "${name}" you want to patch does not exist`;
    }
    if (normalizedSubresource) {
      // Append the subresource to the object's path and PATCH it. This is how
      // an in-place Pod resize reaches `pods/{name}/resize`.
      const result = await mergePatch(
        api,
        `${path}/${normalizedSubresource}`,
        data,
        STRATEGIC_MERGE_PATCH_CONTENT_TYPE,
      );
      console.log("[Tool invocation result: patchKubernetesResource] - ", result);
      return `${kind} "${name}" ${normalizedSubresource} subresource patched successfully`;
    }
    const result = await mergePatch(api, path, data);
    console.log("[Tool invocation result: patchKubernetesResource] - ", result);
    return `${kind} patched successfully`;
  } catch (error) {
    console.error("[Tool invocation error: patchKubernetesResource] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Delete a resource by name. For namespaced kinds a namespace is required.
 *
 * The `mode` mirrors the host `KubeObjectDeleteService` deletion modes:
 * - `delete` (default): standard delete with background propagation.
 * - `force_delete`: immediate delete with a zero grace period and background
 *   propagation.
 * - `force_finalize`: clear the object's finalizers via a merge patch so a
 *   resource stuck in `Terminating` can be removed.
 */
export async function deleteKubernetesResource(
  { kind, apiVersion, name, namespace, mode = DEFAULT_DELETE_MODE }: DeleteResourceInput,
  config?: RunnableConfig,
): Promise<string> {
  console.log("[Tool invocation: deleteKubernetesResource] - kind:", kind, "name:", name, "mode:", mode);
  const target = await resolveTarget(config, kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { api, resource } = target;
  if (resource.namespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to delete "${name}".`;
  }

  const backup = await captureResourceYaml(api, resource, name, namespace);
  if (!requestApproval(`DELETE ${kind.toUpperCase()}`, { name, namespace, mode }, backup)) {
    return "The user denied the action";
  }

  try {
    const path = resourcePath(resource, { name, namespace });
    const item = await api.get<RawObject>(path);
    if (!item) {
      return `The ${kind} "${name}" you want to delete does not exist`;
    }
    switch (mode) {
      case "force_delete":
        await deleteObject(api, path, true);
        break;
      case "force_finalize":
        await mergePatch(api, path, { metadata: { finalizers: [] } });
        break;
      default:
        await deleteObject(api, path, false);
        break;
    }
    const resultMessage =
      mode === "force_finalize"
        ? `${kind} finalizers cleared successfully`
        : `${kind} ${mode === "force_delete" ? "force-" : ""}deleted successfully`;
    console.log("[Tool invocation result: deleteKubernetesResource] - ", resultMessage);
    return resultMessage;
  } catch (error) {
    console.error("[Tool invocation error: deleteKubernetesResource] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Delete a pod using one of the pod-specific variants of the host's `PodApi`,
 * by path:
 * - `evict`: request a graceful eviction honoring any matching
 *   PodDisruptionBudget (POST to the pod's `eviction` subresource).
 * - `force_delete`: delete immediately with a zero grace period, useful for pods
 *   stuck on an unreachable node.
 * - `delete_with_finalizers`: remove the pod's finalizers with a JSON merge
 *   patch that sets them to `null`, then force delete it, so a pod stuck in
 *   `Terminating` is removed. In a strategic merge patch `metadata.finalizers`
 *   has the patch strategy `merge`, so an empty list there adds nothing and
 *   removes nothing: that is what the host's `PodApi.deleteWithFinalizers`
 *   sends, and the pod stays in `Terminating` (freelensapp/freelens#2759).
 */
export async function deletePod({ name, namespace, mode }: DeletePodInput, config?: RunnableConfig): Promise<string> {
  console.log("[Tool invocation: deletePod] - name:", name, "namespace:", namespace, "mode:", mode);
  if (!namespace) {
    return `Pods are namespaced; please provide a namespace to delete "${name}".`;
  }
  const api = clusterApiFor(config);
  if (typeof api === "string") {
    return api;
  }

  const backup = await captureResourceYaml(api, POD, name, namespace);
  if (!requestApproval(`DELETE POD (${mode})`, { name, namespace, mode }, backup)) {
    return "The user denied the action";
  }

  const path = resourcePath(POD, { name, namespace });
  try {
    switch (mode) {
      case "evict":
        await api.post(`${path}/eviction`, {
          data: asRequestData({ apiVersion: "policy/v1", kind: "Eviction", metadata: { name, namespace } }),
        });
        return `Pod "${name}" evicted successfully`;
      case "force_delete":
        await deleteObject(api, path, true);
        return `Pod "${name}" force-deleted successfully`;
      case "delete_with_finalizers":
        try {
          await mergePatch(api, path, { metadata: { finalizers: null } });
        } catch (error) {
          // As the host does: when the patch fails, force delete anyway.
          console.warn("Failed to remove finalizers, proceeding with force delete", error);
        }
        try {
          await deleteObject(api, path, true);
        } catch (error) {
          // A pod already in Terminating is removed by the API server as soon
          // as its finalizers are gone, and the delete finds nothing.
          if (!isNotFound(error)) {
            throw error;
          }
        }
        return `Pod "${name}" deleted and finalizers cleared successfully`;
    }
  } catch (error) {
    console.error("[Tool invocation error: deletePod] - ", error);
    return JSON.stringify(error);
  }
}

// The HTTP status of a failed request. The host's JsonApi throws a
// `JsonApiErrorParsed`, which keeps the API server's Status as `error`; a GET
// answered with 403 throws the Status itself.
function statusCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const { code, error: status } = error as { code?: unknown; error?: { code?: unknown } };
  if (typeof code === "number") {
    return code;
  }
  return typeof status?.code === "number" ? status.code : undefined;
}

const isNotFound = (error: unknown) => statusCodeOf(error) === 404;

/**
 * Restart a workload by triggering a rollout restart, as the host's
 * `DeploymentApi.restart()` and its DaemonSet/StatefulSet equivalents do: a
 * strategic merge patch of the `kubectl.kubernetes.io/restartedAt` annotation
 * of the pod template. This rolls the pods without deleting them directly.
 * Only restartable kinds are accepted; a namespace is always required.
 */
export async function restartKubernetesResource(
  { kind, name, namespace }: RestartResourceInput,
  config?: RunnableConfig,
): Promise<string> {
  console.log("[Tool invocation: restartKubernetesResource] - kind:", kind, "name:", name, "namespace:", namespace);
  if (!isRestartableKind(kind)) {
    return `Restart is not supported for kind "${kind}". Supported kinds: ${RESTARTABLE_KINDS.join(", ")}.`;
  }
  if (!namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to restart "${name}".`;
  }
  const target = await resolveTarget(config, kind, "apps/v1");
  if (typeof target === "string") {
    return target;
  }
  const { api, resource } = target;

  const backup = await captureResourceYaml(api, resource, name, namespace);
  if (!requestApproval(`RESTART ${kind.toUpperCase()}`, { name, namespace }, backup)) {
    return "The user denied the action";
  }

  try {
    await mergePatch(
      api,
      resourcePath(resource, { name, namespace }),
      {
        spec: {
          template: { metadata: { annotations: { "kubectl.kubernetes.io/restartedAt": new Date().toISOString() } } },
        },
      },
      STRATEGIC_MERGE_PATCH_CONTENT_TYPE,
    );
    console.log("[Tool invocation result: restartKubernetesResource] - ", `${kind} "${name}" restarted successfully`);
    return `${kind} "${name}" restarted successfully`;
  } catch (error) {
    console.error("[Tool invocation error: restartKubernetesResource] - ", error);
    return JSON.stringify(error);
  }
}

// A failed log read: the API server's Status, whose `message` the pod-log
// helpers match on.
const readLogsError = (status: number, text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return { code: status, message: text };
  }
};

/**
 * Read a one-shot snapshot of container logs from a pod. Loads the pod to
 * enumerate its containers, runs the optional approval gate (controlled by the
 * `podLogsRequireApproval` preference), then fetches the logs and caps the
 * output so it cannot overflow the model context.
 */
export async function getPodLogs(input: GetPodLogsInput, config?: RunnableConfig): Promise<string> {
  const { name, namespace, container, previous, timestamps } = input;
  console.log(
    "[Tool invocation: getPodLogs] - name:",
    name,
    "namespace:",
    namespace,
    "container:",
    container,
    "previous:",
    previous,
  );

  if (!namespace) {
    return `Pods are namespaced; please provide a namespace to read logs for "${name}".`;
  }

  // Compile the optional regex filter up front so an invalid expression is
  // reported before the pod is loaded or its logs are fetched.
  const filterResolution = compileLogFilter(input.filter);
  if (filterResolution.kind === "error") {
    return filterResolution.message;
  }

  const api = clusterApiFor(config);
  if (typeof api === "string") {
    return api;
  }
  const path = resourcePath(POD, { name, namespace });

  let pod: RawObject | undefined;
  try {
    pod = await api.get<RawObject>(path);
  } catch (error) {
    console.error("[Tool invocation error: getPodLogs] - ", error);
    return JSON.stringify(error);
  }
  if (!pod) {
    return `The Pod "${name}" was not found in namespace "${namespace}".`;
  }

  const resolution = resolveContainer(container, collectContainerNames(pod.spec));
  if (resolution.kind !== "resolved") {
    return resolution.message;
  }
  const selectedContainer = resolution.container;

  const preferences = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  const tailLines = capTailLines(input.tailLines, preferences.podLogsTailLines);

  if (
    preferences.podLogsRequireApproval &&
    !requestApproval("READ LOGS POD", { name, namespace, container: selectedContainer, previous })
  ) {
    return "The user denied the action";
  }

  try {
    // Read as text: a log is not JSON, even when a line of it happens to be.
    const response = await api.getResponse(`${path}/log`, {
      query: { container: selectedContainer, tailLines, timestamps, previous },
    });
    const logs = await response.text();
    if (!response.ok) {
      throw readLogsError(response.status, logs);
    }
    if (!logs || logs.trim().length === 0) {
      return emptyLogsMessage(selectedContainer, name, previous);
    }
    if (filterResolution.kind === "regex") {
      const filtered = filterLogLines(logs, filterResolution.regex);
      if (filtered.trim().length === 0) {
        return noMatchingLogsMessage(selectedContainer, name, input.filter as string);
      }
      return capLogOutput(filtered);
    }
    return capLogOutput(logs);
  } catch (error) {
    // A "previous terminated container ... not found" response is expected when
    // previous: true is requested but the container has never terminated. Treat
    // it as a normal "no previous logs" result so the model does not report it
    // as a tool error.
    if (isPreviousContainerNotFoundError(error)) {
      return emptyLogsMessage(selectedContainer, name, previous);
    }
    console.error("[Tool invocation error: getPodLogs] - ", error);
    return JSON.stringify(error);
  }
}
