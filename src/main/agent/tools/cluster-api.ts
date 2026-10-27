// How the cluster tools reach the chat's cluster from main: every request goes
// through the host's JSON client for that cluster, by path, with the abort
// signal of the tool call.

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
