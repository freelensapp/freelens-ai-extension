# Where cluster tools execute

Type: grilling
Status: open
Blocked by: 07

## Question

With the agent loop in main, where does each tool's `execute` actually talk to
the cluster?

- (a) In main through `Main.K8s.*` keyed by cluster id (Freelens's own
  authenticated proxy; list/get/create/update/patch/delete only), rewriting
  `tools/kubernetes-resource.ts` off `Renderer.K8sApi`. Pod logs have no
  `Main.K8s` call: decide between `Main.K8sApi.forCluster` (unverified), a
  narrow renderer fallback, or a raw client for logs only.
- (b) In the renderer cluster frame: main broadcasts a request and the owning
  frame answers through `Renderer.Ipc.invoke`, reusing the existing code. Main
  can only broadcast, so this needs request ids and frame filtering.
- (c) In main with a separate Kubernetes client built from
  `ClusterInfo.kubeConfigPath` / `contextName` (has to handle exec plugins,
  tokens and proxies itself).

Also: how a chat is bound to a cluster id, and what a tool call does when the
cluster is disconnected (`ClusterNotAccessible`).

Facts: [Freelens main-process API](07-research-freelens-main-api.md).
