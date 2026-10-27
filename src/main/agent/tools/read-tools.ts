// The read tools, run in main on the host's JSON client of the chat's cluster.
// Every request goes by path; a kind resolves to its path through the API
// server's discovery document of its group version.

import {
  getClusterVersionTool,
  getKubernetesResourceTool,
  getNamespacesTool,
  getPodLogsTool,
  getWarningEventsByNamespaceTool,
  listKubernetesResourcesTool,
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
import { type KubernetesVersionInfo, summarizeClusterVersion } from "../../../common/agent-tools/version-summary";
import {
  type ClusterToolContext,
  type ClusterToolRunner,
  POD_RESOURCE,
  type RawObject,
  resolveResource,
} from "./cluster-api";
import { resourcePath } from "./resource-paths";

interface RawList<T = RawObject> {
  items?: T[];
}

interface RawEvent extends RawObject {
  type?: string;
  message?: string;
  reason?: string;
  action?: string;
  involvedObject?: unknown;
  source?: unknown;
}

interface ListResourceInput {
  kind: string;
  apiVersion?: string;
  namespace?: string;
  includeManagedFields?: boolean;
  fields?: string[];
}

interface GetResourceInput {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  includeManagedFields?: boolean;
  fields?: string[];
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

/** The field selector for `fields`, or the parse error text for a malformed one. */
function fieldSelector(fields?: string[]): FieldSelector | null | string {
  try {
    return buildFieldSelector(fields);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function getClusterVersion({ api, signal }: ClusterToolContext): Promise<string> {
  const info = await api.get<KubernetesVersionInfo>("/version", undefined, { signal });
  if (!info || typeof info !== "object") {
    return "Could not determine the Kubernetes cluster version.";
  }
  return JSON.stringify(summarizeClusterVersion(info));
}

async function getNamespaces({ api, signal }: ClusterToolContext): Promise<string> {
  const list = await api.get<RawList>("/api/v1/namespaces", undefined, { signal });
  return JSON.stringify((list.items ?? []).map((item) => item.metadata?.name ?? "").filter((name) => name.length > 0));
}

async function getWarningEventsByNamespace(
  { api, signal }: ClusterToolContext,
  { namespace }: { namespace: string },
): Promise<string> {
  const list = await api.get<RawList<RawEvent>>(
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/events`,
    { query: { fieldSelector: "type=Warning" } },
    { signal },
  );
  return JSON.stringify(
    (list.items ?? [])
      .filter((event) => event.type === "Warning")
      .map(({ type, message, reason, action, involvedObject, source }) => ({
        event: { type, message, reason, action, involvedObject, source },
      })),
  );
}

/** A namespaced kind is listed in `namespace` when given, else across all namespaces. */
async function listKubernetesResources(
  context: ClusterToolContext,
  { kind, apiVersion, namespace, includeManagedFields, fields }: ListResourceInput,
): Promise<string> {
  const resource = await resolveResource(context, kind, apiVersion);
  if (typeof resource === "string") return resource;
  const select = fieldSelector(fields);
  if (typeof select === "string") return select;
  const list = await context.api.get<RawList>(resourcePath(resource, { namespace }), undefined, {
    signal: context.signal,
  });
  const projected = (list.items ?? []).map((item) => projectObject(item, includeManagedFields));
  return JSON.stringify(select ? projected.map(select) : projected);
}

async function getKubernetesResource(
  context: ClusterToolContext,
  { kind, apiVersion, name, namespace, includeManagedFields, fields }: GetResourceInput,
): Promise<string> {
  const resource = await resolveResource(context, kind, apiVersion);
  if (typeof resource === "string") return resource;
  if (resource.namespaced && !namespace) {
    return `Kind "${kind}" is namespaced; please provide a namespace to get "${name}".`;
  }
  const select = fieldSelector(fields);
  if (typeof select === "string") return select;
  const object = await context.api.get<RawObject>(resourcePath(resource, { name, namespace }), undefined, {
    signal: context.signal,
  });
  const projected = projectObject(object, includeManagedFields);
  return JSON.stringify(select ? select(projected) : projected);
}

// A failed log read: the API server's Status, whose `message` the pod logs
// helpers match on.
const logReadError = (status: number, text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return { code: status, message: text };
  }
};

/** Reads a capped, optionally filtered snapshot of a container's logs. */
async function getPodLogs(
  { api, signal, podLogsTailLines }: ClusterToolContext,
  input: GetPodLogsInput,
): Promise<string> {
  const { name, namespace, container, previous, timestamps } = input;
  // An invalid expression is reported before anything is loaded.
  const filter = compileLogFilter(input.filter);
  if (filter.kind === "error") return filter.message;

  const path = resourcePath(POD_RESOURCE, { name, namespace });
  const pod = await api.get<RawObject>(path, undefined, { signal });
  const resolution = resolveContainer(container, collectContainerNames(pod.spec));
  if (resolution.kind !== "resolved") return resolution.message;
  const selected = resolution.container;

  // Only the parameters that are set: an empty value (`previous=`) reads as
  // true on the API server.
  const query: Record<string, string | number | boolean> = {
    container: selected,
    tailLines: capTailLines(input.tailLines, podLogsTailLines),
  };
  if (timestamps !== undefined) query.timestamps = timestamps;
  if (previous !== undefined) query.previous = previous;

  // Read as text: a log is not JSON, even when a line of it is.
  const response = await api.getResponse(`${path}/log`, { query }, { signal });
  const logs = await response.text();
  if (!response.ok) {
    const error = logReadError(response.status, logs);
    // Expected when previous: true is asked for a container that never terminated.
    if (isPreviousContainerNotFoundError(error)) return emptyLogsMessage(selected, name, previous);
    throw error;
  }
  if (logs.trim().length === 0) return emptyLogsMessage(selected, name, previous);
  if (filter.kind === "regex") {
    const filtered = filterLogLines(logs, filter.regex);
    if (filtered.trim().length === 0) return noMatchingLogsMessage(selected, name, input.filter as string);
    return capLogOutput(filtered);
  }
  return capLogOutput(logs);
}

/** The read tools by name. pi checks each call's arguments against the shared schema first. */
export const READ_TOOL_RUNNERS: Readonly<Record<string, ClusterToolRunner>> = {
  [getClusterVersionTool.name]: (_args, context) => getClusterVersion(context),
  [getNamespacesTool.name]: (_args, context) => getNamespaces(context),
  [getWarningEventsByNamespaceTool.name]: (args, context) =>
    getWarningEventsByNamespace(context, args as { namespace: string }),
  [listKubernetesResourcesTool.name]: (args, context) =>
    listKubernetesResources(context, args as unknown as ListResourceInput),
  [getKubernetesResourceTool.name]: (args, context) =>
    getKubernetesResource(context, args as unknown as GetResourceInput),
  [getPodLogsTool.name]: (args, context) => getPodLogs(context, args as unknown as GetPodLogsInput),
};
