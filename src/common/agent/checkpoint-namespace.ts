// The `PersistentMemorySaver` persists each agent's LangGraph checkpointer state
// under a namespace key in the shared, host-managed `AgentStateStore`. Because
// that store is backed by a single JSON file shared across every cluster frame,
// the namespace must include the cluster id so each connected cluster keeps its
// own agent memory instead of overwriting (or reading) another cluster's blob.
//
// Pure helpers with no host/MobX dependencies so they can be unit-tested
// directly (see checkpoint-namespace.test.ts).

const SEPARATOR = "::";

/**
 * Build the checkpoint namespace for a given cluster and agent kind
 * (e.g. "freelens", "mcp").
 */
export function checkpointNamespace(clusterId: string, agentKind: string): string {
  return `${clusterId}${SEPARATOR}${agentKind}`;
}

/**
 * Whether a stored checkpoint namespace belongs to the given cluster. Used to
 * clear only the current cluster's checkpoints without touching other clusters.
 */
export function belongsToCluster(namespace: string, clusterId: string): boolean {
  return namespace.startsWith(`${clusterId}${SEPARATOR}`);
}
