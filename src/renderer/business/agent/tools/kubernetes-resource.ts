import { Renderer } from "@freelensapp/extensions";
import { interrupt } from "@langchain/langgraph";
import { stringify as stringifyYaml } from "yaml";
import { PreferencesStore } from "../../../../common/store";
import { type KubernetesVersionInfo, summarizeClusterVersion } from "./cluster-version";
import {
  capLogOutput,
  capTailLines,
  collectContainerNames,
  emptyLogsMessage,
  type GetPodLogsInput,
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

type KubeApi = Renderer.K8sApi.KubeApi;
type KubeObject = Renderer.K8sApi.KubeObject;
// Use the exact store type returned by the host ApiManager rather than the
// public alias, which differs structurally (it requires extra dependencies).
type KubeObjectStore = NonNullable<ReturnType<typeof Renderer.K8sApi.apiManager.getStore>>;

interface ResolvedTarget {
  api: KubeApi;
  store: KubeObjectStore;
}

export interface ListResourceInput {
  kind: string;
  apiVersion?: string;
  namespace?: string;
  // Server-side apply bookkeeping (`metadata.managedFields`) is stripped by
  // default to keep the output small; set this to opt back in when needed.
  includeManagedFields?: boolean;
}

export interface GetResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  // See ListResourceInput.includeManagedFields.
  includeManagedFields?: boolean;
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

// Workload APIs that expose a rollout `restart()` endpoint. Their `restart`
// signatures are identical, so the union accepts the shared call below.
type RestartableApi =
  | typeof Renderer.K8sApi.deploymentApi
  | typeof Renderer.K8sApi.daemonSetApi
  | typeof Renderer.K8sApi.statefulSetApi;

/**
 * Resolve the host KubeApi exposing `restart()` for a restartable kind.
 */
function getRestartableApi(kind: string): RestartableApi | undefined {
  switch (kind) {
    case "Deployment":
      return Renderer.K8sApi.deploymentApi;
    case "DaemonSet":
      return Renderer.K8sApi.daemonSetApi;
    case "StatefulSet":
      return Renderer.K8sApi.statefulSetApi;
    default:
      return undefined;
  }
}

/**
 * Resolve the host KubeApi and store for a given kind/apiVersion. Returns a
 * human-readable error string when resolution is not possible so the model can
 * react (for example by supplying an explicit apiVersion for a CRD).
 */
function resolveTarget(kind: string, apiVersion?: string): ResolvedTarget | string {
  const version = resolveApiVersion(kind, apiVersion);
  if (!version) {
    return `Could not resolve the apiVersion for kind "${kind}". Provide an explicit apiVersion (for example "apps/v1").`;
  }
  const api = Renderer.K8sApi.apiManager.getApiByKind(kind, version);
  if (!api) {
    return `Could not resolve a Kubernetes API for kind "${kind}" and apiVersion "${version}".`;
  }
  const store = Renderer.K8sApi.apiManager.getStore(api);
  if (!store) {
    return `Could not resolve a store for kind "${kind}".`;
  }
  return { api, store };
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
 * Build a restorable manifest from a loaded host object: the full resource as it
 * exists now, used as the backup presented before a destructive change.
 */
function toBackupManifest(object: KubeObject) {
  return {
    apiVersion: object.apiVersion,
    kind: object.kind,
    metadata: object.metadata,
    spec: object.spec,
    status: object.status,
  };
}

// Minimal structural view of a store used only to load a resource for the
// backup. The host's concrete stores (PodStore, DeploymentStore, ...) are more
// specific than the generic `KubeObjectStore` alias and not mutually
// assignable, so the capture helper depends on `load` alone.
interface LoadableStore {
  load(params: { name: string; namespace?: string }): Promise<KubeObject | null | undefined>;
}

/**
 * Best-effort capture of the current YAML of a resource before it is changed.
 * Returns `undefined` (rather than throwing) when the resource cannot be loaded,
 * so a missing backup never blocks the approval prompt.
 */
async function captureResourceYaml(
  store: LoadableStore,
  namespaced: boolean,
  name: string,
  namespace?: string,
): Promise<string | undefined> {
  try {
    const object = await store.load({ name, namespace: namespaced ? namespace : undefined });
    if (!object) {
      return undefined;
    }
    return stringifyYaml(toBackupManifest(object));
  } catch (error) {
    console.error("[Backup capture error] - ", error);
    return undefined;
  }
}

function projectObject(object: KubeObject, includeManagedFields = false) {
  return {
    name: object.getName(),
    namespace: object.getNs(),
    spec: object.spec,
    status: object.status,
    metadata: stripManagedFields(object.metadata, includeManagedFields),
  };
}

// The host store types its mutating params as a deep-partial of the KubeObject
// (including its methods), which a free-form manifest cannot satisfy directly.
// Cast through `unknown` to the exact expected type rather than using `as any`.
type CreateData = Parameters<KubeObjectStore["create"]>[1];
type UpdateData = Parameters<KubeObjectStore["update"]>[1];
type DeleteOptions = Parameters<KubeObjectStore["removeWithOptions"]>[1];

// The host KubeApi has no public method to patch a subresource: its `patch`
// builds the URL from `formatUrlForNotListing` and never appends a subresource,
// and the underlying KubeJsonApi `request` client is protected. Describe the
// minimal surface we rely on and reach it through a structural cast (the
// project forbids `as any`, so we go through `unknown` to a precise shape).
interface SubresourcePatchApi {
  formatUrlForNotListing(desc: { name?: string; namespace?: string }): string;
  request: {
    patch(path: string, params: { data: unknown }, reqInit: { headers: Record<string, string> }): Promise<unknown>;
  };
}

// The host KubeApi exposes the shared cluster `KubeJsonApi` client through a
// protected `request` property with no public accessor. Describe the minimal
// surface we rely on (a typed GET) and reach it through a structural cast via
// `unknown`, mirroring the `SubresourcePatchApi` pattern above (the project
// forbids `as any`).
interface VersionRequestApi {
  request: {
    get<T>(path: string): Promise<T>;
  };
}

// Kubernetes content-type for a strategic merge patch. Subresource patches such
// as in-place Pod resize update entries inside arrays (spec.containers) that are
// merged by their `name` key, so a strategic merge is required; a plain JSON
// merge patch would replace the whole array.
const STRATEGIC_MERGE_PATCH_CONTENT_TYPE = "application/strategic-merge-patch+json";

/**
 * List resources of a kind, loading them from the store on demand. Namespaced
 * kinds are scoped to `namespace` when provided; otherwise all loaded
 * namespaces are returned.
 */
export async function listKubernetesResources({
  kind,
  apiVersion,
  namespace,
  includeManagedFields,
}: ListResourceInput): Promise<string> {
  console.log("[Tool invocation: listKubernetesResources] - kind:", kind, "namespace:", namespace);
  const target = resolveTarget(kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { api, store } = target;
  try {
    const scoped = api.isNamespaced && namespace ? [namespace] : undefined;
    const loaded = await store.loadAll(scoped ? { namespaces: scoped } : {});
    const items = loaded ?? (scoped ? store.getAllByNs(namespace as string) : store.items.toJSON());
    return JSON.stringify(items.map((item) => projectObject(item, includeManagedFields)));
  } catch (error) {
    console.error("[Tool invocation error: listKubernetesResources] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Get a single resource by name, loading it from the store on demand. For
 * namespaced kinds a namespace is required.
 */
export async function getKubernetesResource({
  kind,
  apiVersion,
  name,
  namespace,
  includeManagedFields,
}: GetResourceInput): Promise<string> {
  console.log("[Tool invocation: getKubernetesResource] - kind:", kind, "name:", name, "namespace:", namespace);
  const target = resolveTarget(kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { api, store } = target;
  if (api.isNamespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to get "${name}".`;
  }
  try {
    const object = await store.load({ name, namespace: api.isNamespaced ? namespace : undefined });
    if (!object) {
      return `The ${kind} "${name}" was not found.`;
    }
    return JSON.stringify(projectObject(object, includeManagedFields));
  } catch (error) {
    console.error("[Tool invocation error: getKubernetesResource] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Read the Kubernetes version of the currently connected cluster by querying
 * the API server's `/version` endpoint directly (the same `version.Info` that
 * `kubectl version` reports). This is the authoritative source for the server
 * version and avoids heuristics such as inspecting node `kubeletVersion`s. Any
 * registered KubeApi shares the cluster `KubeJsonApi` client, so the pods API
 * is used to reach it.
 */
export async function getClusterVersion(): Promise<string> {
  console.log("[Tool invocation: getClusterVersion]");
  const api = Renderer.K8sApi.podsApi as unknown as VersionRequestApi;
  try {
    const info = await api.request.get<KubernetesVersionInfo>("/version");
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
 * Create a resource. Known kinds are validated and prepared via their handler;
 * unknown kinds (CRDs) are applied as free YAML/JSON.
 */
export async function createKubernetesResource({
  kind,
  apiVersion,
  name,
  namespace,
  data,
}: CreateResourceInput): Promise<string> {
  console.log("[Tool invocation: createKubernetesResource] - kind:", kind);
  const target = resolveTarget(kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { store } = target;

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
    const result = await store.create(
      { name: resourceName, namespace: resourceNamespace },
      manifest as unknown as CreateData,
    );
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
export async function updateKubernetesResource({
  kind,
  apiVersion,
  name,
  namespace,
  data,
}: WriteResourceInput): Promise<string> {
  console.log("[Tool invocation: updateKubernetesResource] - kind:", kind, "name:", name);
  const target = resolveTarget(kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { api, store } = target;
  if (api.isNamespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to update "${name}".`;
  }

  const validation = validateManifest(kind, data);
  if (!validation.success) {
    return `The ${kind} manifest is invalid: ${validation.error}`;
  }
  const manifest = prepareManifest(kind, validation.data);

  const backup = await captureResourceYaml(store, api.isNamespaced, name, namespace);
  if (!requestApproval(`UPDATE ${kind.toUpperCase()}`, { name, namespace, data: manifest }, backup)) {
    return "The user denied the action";
  }

  try {
    const item = await store.load({ name, namespace: api.isNamespaced ? namespace : undefined });
    if (!item) {
      return `The ${kind} "${name}" you want to update does not exist`;
    }
    const result = await store.update(item, manifest as unknown as UpdateData);
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
export async function patchKubernetesResource({
  kind,
  apiVersion,
  name,
  namespace,
  data,
  subresource,
}: WriteResourceInput): Promise<string> {
  const normalizedSubresource = normalizeSubresource(subresource);
  console.log(
    "[Tool invocation: patchKubernetesResource] - kind:",
    kind,
    "name:",
    name,
    "subresource:",
    normalizedSubresource,
  );
  const target = resolveTarget(kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { api, store } = target;
  if (api.isNamespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to patch "${name}".`;
  }

  const backup = await captureResourceYaml(store, api.isNamespaced, name, namespace);
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
    const item = await store.load({ name, namespace: api.isNamespaced ? namespace : undefined });
    if (!item) {
      return `The ${kind} "${name}" you want to patch does not exist`;
    }
    if (normalizedSubresource) {
      // The host store/api cannot target a subresource, so build the resource
      // URL, append the subresource and PATCH it directly through the KubeApi
      // request client. This is how an in-place Pod resize reaches
      // `pods/{name}/resize`.
      const patchApi = api as unknown as SubresourcePatchApi;
      const baseUrl = patchApi.formatUrlForNotListing({
        name,
        namespace: api.isNamespaced ? namespace : undefined,
      });
      const result = await patchApi.request.patch(
        `${baseUrl}/${normalizedSubresource}`,
        { data },
        { headers: { "content-type": STRATEGIC_MERGE_PATCH_CONTENT_TYPE } },
      );
      console.log("[Tool invocation result: patchKubernetesResource] - ", result);
      return `${kind} "${name}" ${normalizedSubresource} subresource patched successfully`;
    }
    const result = await store.patch(item, data as unknown as UpdateData, "merge");
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
 * - `delete` (default): standard delete (`store.remove`).
 * - `force_delete`: immediate delete with a zero grace period and background
 *   propagation (`store.removeWithOptions`).
 * - `force_finalize`: clear the object's finalizers via a merge patch so a
 *   resource stuck in `Terminating` can be removed (`store.patch`).
 */
export async function deleteKubernetesResource({
  kind,
  apiVersion,
  name,
  namespace,
  mode = DEFAULT_DELETE_MODE,
}: DeleteResourceInput): Promise<string> {
  console.log("[Tool invocation: deleteKubernetesResource] - kind:", kind, "name:", name, "mode:", mode);
  const target = resolveTarget(kind, apiVersion);
  if (typeof target === "string") {
    return target;
  }
  const { api, store } = target;
  if (api.isNamespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to delete "${name}".`;
  }

  const backup = await captureResourceYaml(store, api.isNamespaced, name, namespace);
  if (!requestApproval(`DELETE ${kind.toUpperCase()}`, { name, namespace, mode }, backup)) {
    return "The user denied the action";
  }

  try {
    const item = await store.load({ name, namespace: api.isNamespaced ? namespace : undefined });
    if (!item) {
      return `The ${kind} "${name}" you want to delete does not exist`;
    }
    switch (mode) {
      case "force_delete":
        await store.removeWithOptions(item, {
          gracePeriodSeconds: 0,
          propagationPolicy: "Background",
        } as unknown as DeleteOptions);
        break;
      case "force_finalize":
        await store.patch(item, { metadata: { finalizers: [] } } as unknown as UpdateData, "merge");
        break;
      default:
        await store.remove(item);
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
 * Delete a pod using one of the pod-specific variants exposed by the host
 * `PodApi`:
 * - `evict`: request a graceful eviction honoring any matching
 *   PodDisruptionBudget (`podsApi.evict`).
 * - `force_delete`: delete immediately with a zero grace period, useful for pods
 *   stuck on an unreachable node (`podsApi.forceDelete`).
 * - `delete_with_finalizers`: delete the pod and clear its finalizers so a pod
 *   stuck in `Terminating` is removed (`podsApi.deleteWithFinalizers`).
 */
export async function deletePod({ name, namespace, mode }: DeletePodInput): Promise<string> {
  console.log("[Tool invocation: deletePod] - name:", name, "namespace:", namespace, "mode:", mode);
  if (!namespace) {
    return `Pods are namespaced; please provide a namespace to delete "${name}".`;
  }

  const podsApi = Renderer.K8sApi.podsApi;
  const podsStore = Renderer.K8sApi.apiManager.getStore(podsApi);
  const backup = podsStore ? await captureResourceYaml(podsStore, podsApi.isNamespaced, name, namespace) : undefined;

  if (!requestApproval(`DELETE POD (${mode})`, { name, namespace, mode }, backup)) {
    return "The user denied the action";
  }

  try {
    switch (mode) {
      case "evict":
        await podsApi.evict({ name, namespace });
        return `Pod "${name}" evicted successfully`;
      case "force_delete":
        await podsApi.forceDelete({ name, namespace });
        return `Pod "${name}" force-deleted successfully`;
      case "delete_with_finalizers":
        await podsApi.deleteWithFinalizers({ name, namespace });
        return `Pod "${name}" deleted and finalizers cleared successfully`;
    }
  } catch (error) {
    console.error("[Tool invocation error: deletePod] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Restart a workload by triggering a rollout restart through its host KubeApi
 * (`DeploymentApi.restart()` and the equivalent DaemonSet/StatefulSet methods).
 * This rolls the pods without deleting them directly. Only restartable kinds are
 * accepted; a namespace is always required.
 */
export async function restartKubernetesResource({ kind, name, namespace }: RestartResourceInput): Promise<string> {
  console.log("[Tool invocation: restartKubernetesResource] - kind:", kind, "name:", name, "namespace:", namespace);
  if (!isRestartableKind(kind)) {
    return `Restart is not supported for kind "${kind}". Supported kinds: ${RESTARTABLE_KINDS.join(", ")}.`;
  }
  const api = getRestartableApi(kind);
  if (!api) {
    return `Could not resolve a Kubernetes API for kind "${kind}".`;
  }
  if (!namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to restart "${name}".`;
  }

  const store = Renderer.K8sApi.apiManager.getStore(api);
  const backup = store ? await captureResourceYaml(store, api.isNamespaced, name, namespace) : undefined;
  if (!requestApproval(`RESTART ${kind.toUpperCase()}`, { name, namespace }, backup)) {
    return "The user denied the action";
  }

  try {
    await api.restart({ name, namespace });
    console.log("[Tool invocation result: restartKubernetesResource] - ", `${kind} "${name}" restarted successfully`);
    return `${kind} "${name}" restarted successfully`;
  } catch (error) {
    console.error("[Tool invocation error: restartKubernetesResource] - ", error);
    return JSON.stringify(error);
  }
}

/**
 * Read a one-shot snapshot of container logs from a pod. Loads the pod to
 * enumerate its containers, runs the optional approval gate (controlled by the
 * `podLogsRequireApproval` preference), then fetches the logs and caps the
 * output so it cannot overflow the model context.
 */
export async function getPodLogs(input: GetPodLogsInput): Promise<string> {
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

  const podsApi = Renderer.K8sApi.podsApi;
  const store = Renderer.K8sApi.apiManager.getStore(podsApi);
  if (!store) {
    return "Could not resolve the Pods store.";
  }

  let pod: KubeObject | undefined;
  try {
    pod = await store.load({ name, namespace });
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
    const logs = await podsApi.getLogs(
      { name, namespace },
      { container: selectedContainer, tailLines, timestamps, previous },
    );
    if (!logs || logs.trim().length === 0) {
      return emptyLogsMessage(selectedContainer, name, previous);
    }
    return capLogOutput(logs);
  } catch (error) {
    console.error("[Tool invocation error: getPodLogs] - ", error);
    return JSON.stringify(error);
  }
}
