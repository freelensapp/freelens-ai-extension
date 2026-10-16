// How the Kubernetes tools reach the chat's cluster from main: the cluster id
// travels in the run config (`configurable.clusterId`, set by agent-service.ts),
// and every request goes through the host's `KubeJsonApi` for that cluster, by
// path, so built-in kinds, custom resources, subresources and `/version` are
// reached the same way.

import { Main } from "@freelensapp/extensions";

import type { RunnableConfig } from "@langchain/core/runnables";

type HostKubeJsonApi = ReturnType<typeof Main.K8sApi.KubeJsonApi.forCluster>;

// The requests of the host's client that the tools send.
export type KubeJsonApi = Pick<HostKubeJsonApi, "get" | "post" | "put" | "patch" | "del" | "getResponse">;

/**
 * The params of a request without the query values that are not set. The host
 * serializes the query with `node:querystring`, which sends an `undefined` or
 * `null` value as an empty one, and the API server reads an empty boolean
 * parameter as `true`: an unset `previous` of the pod logs would ask for the
 * previous container.
 */
const withSetQueryValues = <Params extends { query?: unknown }>(params?: Params): Params | undefined => {
  const query = params?.query;
  if (!query || typeof query !== "object") {
    return params;
  }
  const entries = Object.entries(query).filter(([, value]) => value !== undefined && value !== null);
  return { ...params, query: Object.fromEntries(entries) };
};

/**
 * The host's client, with every request leaving out the query values that are
 * not set, so that an optional parameter of a tool is sent only when it has a
 * value.
 */
const sendingSetQueryValues = (api: HostKubeJsonApi): KubeJsonApi => ({
  get: (path, params, init) => api.get(path, withSetQueryValues(params), init),
  post: (path, params, init) => api.post(path, withSetQueryValues(params), init),
  put: (path, params, init) => api.put(path, withSetQueryValues(params), init),
  patch: (path, params, init) => api.patch(path, withSetQueryValues(params), init),
  del: (path, params, init) => api.del(path, withSetQueryValues(params), init),
  getResponse: (path, params, init) => api.getResponse(path, withSetQueryValues(params), init),
});

export const clusterIdFromConfig = (config?: RunnableConfig): string | undefined => {
  const clusterId: unknown = config?.configurable?.clusterId;
  return typeof clusterId === "string" && clusterId.length > 0 ? clusterId : undefined;
};

/**
 * The host's JSON client for the run's cluster, or a message for the model when
 * the run names no cluster or Freelens does not know it.
 */
export const clusterApiFor = (config?: RunnableConfig): KubeJsonApi | string => {
  const clusterId = clusterIdFromConfig(config);
  if (!clusterId) {
    return "No cluster is selected for this chat.";
  }
  if (!Main.Catalog.getClusterById(clusterId)) {
    return `The cluster "${clusterId}" of this chat is not known to Freelens.`;
  }
  return sendingSetQueryValues(Main.K8sApi.KubeJsonApi.forCluster(clusterId));
};
