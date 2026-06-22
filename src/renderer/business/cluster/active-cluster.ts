import { Renderer } from "@freelensapp/extensions";

// Fallback key used when no active cluster can be resolved (for example on an
// older host that does not expose the catalog API). It keeps the chat usable
// instead of throwing, while still giving every unresolved frame a single,
// stable bucket.
export const DEFAULT_CLUSTER_ID = "default";

/**
 * The id of the cluster whose Freelens cluster frame this renderer code runs in.
 *
 * Each connected cluster gets its own cluster frame, but the durable, host-
 * managed stores (chat transcript, conversation thread id, agent checkpoint
 * state) are backed by single JSON files shared across every frame. Keying those
 * stores by this id is what keeps the chat session, conversation thread, and
 * agent memory separate per cluster instead of every cluster sharing one chat.
 *
 * Resolved once when the chat page mounts: the frame belongs to exactly one
 * cluster for its whole lifetime, so the active cluster at mount time is the
 * frame's own cluster.
 */
export function getActiveClusterId(): string {
  try {
    const id = Renderer.Catalog.getActiveCluster()?.id;
    return id && id.length > 0 ? id : DEFAULT_CLUSTER_ID;
  } catch {
    return DEFAULT_CLUSTER_ID;
  }
}
