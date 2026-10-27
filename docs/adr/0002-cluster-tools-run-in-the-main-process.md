# Cluster tools run in the main process

The cluster tools of the pi agent reach the cluster from the main process,
through `Main.K8sApi.KubeJsonApi.forCluster(clusterId)`. Requests go by path,
and kinds are resolved from the API server's discovery documents. This reverses
[Where cluster tools execute](../../.scratch/pi-agent-core/issues/08-where-cluster-tools-execute.md).
That ticket ran the tools in the cluster frame because the Freelens v1
main-process API had no `forCluster`, no pod logs and no subresources, and
guessed resource paths from the kind. Freelens v2 removes all of these limits.
Running the tools in the main process removes the tool round trip to the frame,
its timeout, and the case of a frame that reloads while a write is pending. It
also stops the tools from loading objects into the UI's stores. Approvals still
need the cluster frame, which shows the approval card.
