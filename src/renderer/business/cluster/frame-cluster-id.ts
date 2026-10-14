/**
 * The cluster id of a Freelens cluster frame, read from the frame's host the
 * same way Freelens does (`getClusterIdFromHost`): cluster frames are served
 * from `<clusterId>.renderer.freelens.app` or `<clusterId>.localhost`. The root
 * window has no cluster id and returns undefined.
 */
export function getClusterIdFromFrameHost(host: string): string | undefined {
  const labels = host.split(":")[0]!.split(".");
  if (labels[labels.length - 1] === "localhost") {
    labels.pop();
  } else if (labels.length >= 3 && labels.slice(-3).join(".") === "renderer.freelens.app") {
    labels.splice(-3);
  } else {
    return undefined;
  }
  const clusterId = labels[labels.length - 1];
  return clusterId ? clusterId : undefined;
}
