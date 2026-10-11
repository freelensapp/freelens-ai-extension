import { Renderer } from "@freelensapp/extensions";
import { getClusterIdFromFrameHost } from "./frame-cluster-id";

/** The cluster of this cluster frame, or undefined in the root window. */
export function getFrameClusterId(): string | undefined {
  return getClusterIdFromFrameHost(window.location.host);
}

// Fallback key used when no active cluster can be resolved (for example on an
// older host that does not expose the catalog API). It keeps the chat usable
// instead of throwing, while still giving every unresolved frame a single,
// stable bucket.
export const DEFAULT_CLUSTER_ID = "default";

/**
 * The id of the cluster whose Freelens cluster frame this renderer code runs in.
 *
 * Each connected cluster gets its own cluster frame, while one agent host in
 * main serves them all. Every command to main carries this id, which keeps each
 * cluster's pi session and chat apart.
 *
 * Resolved once when the chat page mounts: the frame belongs to exactly one
 * cluster for its whole lifetime, so the active cluster at mount time is the
 * frame's own cluster.
 */
export function getActiveClusterId(): string {
  const frameClusterId = getFrameClusterId();
  if (frameClusterId) {
    return frameClusterId;
  }
  try {
    const id = Renderer.Catalog.getActiveCluster()?.id;
    return id && id.length > 0 ? id : DEFAULT_CLUSTER_ID;
  } catch {
    return DEFAULT_CLUSTER_ID;
  }
}
