// How the Kubernetes tools reach the chat's cluster from main: the cluster id
// travels in the run config (`configurable.clusterId`, set by agent-service.ts),
// and every request goes through the host's `KubeJsonApi` for that cluster, by
// path, so built-in kinds, custom resources, subresources and `/version` are
// reached the same way.

import { Main } from "@freelensapp/extensions";

import type { RunnableConfig } from "@langchain/core/runnables";

export type KubeJsonApi = ReturnType<typeof Main.K8sApi.KubeJsonApi.forCluster>;

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
  return Main.K8sApi.KubeJsonApi.forCluster(clusterId);
};
