// How the cluster tools reach the chat's cluster from main: every request goes
// through the host's JSON client for that cluster, by path, with the abort
// signal of the tool call.

import { resolveApiVersion } from "../../../common/agent-tools/resource-handlers";
import { type ApiResourceList, findApiResource, groupVersionPath, type ResolvedResource } from "./resource-paths";

import type { Main } from "@freelensapp/extensions";

export type KubeJsonApi = ReturnType<typeof Main.K8sApi.KubeJsonApi.forCluster>;

export interface ClusterToolContext {
  api: KubeJsonApi;
  /** pi's signal for the tool call: Stop aborts the request in progress. */
  signal?: AbortSignal;
  /** The "pod logs tail lines" preference. */
  podLogsTailLines: number;
}

/** Runs one tool call against the cluster; pi has checked the arguments against the tool's schema. */
export type ClusterToolRunner = (args: Record<string, unknown>, context: ClusterToolContext) => Promise<string>;

/** A Kubernetes object as the API server returns it. */
export interface RawObject {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string; finalizers?: string[]; [key: string]: unknown };
  spec?: unknown;
  status?: unknown;
}

export const POD_RESOURCE: ResolvedResource = { kind: "Pod", apiVersion: "v1", plural: "pods", namespaced: true };

/**
 * What a request read with `getResponse` failed with: the API server's
 * `Status` when the answer is one, which `describeRequestError` describes and
 * the pod logs helpers match on, or the answer's text.
 */
export const failedResponseError = (status: number, text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return { code: status, message: text };
  }
};

/**
 * The resource of a kind at an apiVersion, from the discovery document fetched
 * now (no cache), or the text for the model when the cluster does not serve it.
 * The document is read with `getResponse`, since only its status tells a group
 * version the server does not serve (404) from a request that failed (403,
 * 5xx), and the host's error for a failed `get` keeps the status private.
 */
export async function resolveResource(
  { api, signal }: Pick<ClusterToolContext, "api" | "signal">,
  kind: string,
  apiVersion?: string,
): Promise<ResolvedResource | string> {
  const version = resolveApiVersion(kind, apiVersion);
  if (!version) {
    return `Could not resolve the apiVersion for kind "${kind}". Provide an explicit apiVersion (for example "apps/v1").`;
  }
  const response = await api.getResponse(groupVersionPath(version), undefined, { signal });
  const text = await response.text();
  if (response.ok) {
    const resource = findApiResource(JSON.parse(text) as ApiResourceList, kind, version);
    if (resource) return resource;
  } else if (response.status !== 404) {
    throw failedResponseError(response.status, text);
  }
  return `Could not resolve a Kubernetes API for kind "${kind}" and apiVersion "${version}".`;
}
