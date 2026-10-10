# Where cluster tools execute

Type: grilling
Status: resolved
Blocked by:

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

## Answer

All three recommendations from grilling round 1 accepted by leo-capvano in
PR #290 (2026-10-05):

- Tools execute **in the renderer cluster frame** (option b). The agent loop
  stays in main; each tool call is broadcast with `clusterId` and `requestId`,
  the owning frame runs today's tool code (`apiManager` discovery,
  `podsApi.getLogs`, `api.restart()`) and replies with `Renderer.Ipc.invoke`.
  Accepted cost: no tool use without an open cluster frame, so no
  background/headless runs for now.
- A chat is bound to the `clusterId` of the frame that started it; every tool
  request carries it. No cross-cluster tools in the first version.
- A disconnected cluster or a frame that does not answer gives the model an
  error tool result (for example "Cluster not connected"), never a thrown
  error. Each call times out after about 30 s (logs may get longer).

The tool code stays in the renderer, so the typebox rewrite from
[What pi replaces](14-what-pi-replaces.md) only concerns the tool schemas
declared to pi in main; the `execute` bodies move behind the IPC request.

## Grilling round 1 (2026-10-05)

New facts since charting (recorded on
[07](07-research-freelens-main-api.md)):

- Main has no `forCluster` and no route to pod logs.
- `Main.K8s` builds paths with a plural-guessing suffix rule, not discovery:
  `Gateway` becomes `gatewaies`, and CRDs with irregular plurals fail. No
  subresources.
- Today's tools (`tools/tools.ts`) are 12: namespaces, cluster version, warning
  events, list/get/create/update/patch/delete resource, pod logs, delete pod,
  restart workload. They resolve kinds via `apiManager` discovery,
  restart via `api.restart()`, and logs via `podsApi.getLogs`.

Q1. Where does `execute` run?
- Recommendation: **(b) in the renderer cluster frame**. Main dispatches a tool
  request (broadcast carrying `clusterId` + `requestId`); the frame that owns
  the chat runs the existing tool code and replies with `Renderer.Ipc.invoke`.
  Reasons: (a) loses logs and cannot reach kinds with irregular plurals, so it
  needs two workarounds on day one; (c) re-implements kubeconfig auth (exec
  plugins, OIDC, proxies) that Freelens already does. The IPC envelope (ids,
  frame filtering) is needed for streaming events anyway (ticket 09), and the
  frame is already required to be open for approvals (ticket 10).
- Cost: the agent cannot use tools with no cluster frame open, which also
  rules out headless/background runs until revisited.

Q2. How is a chat bound to a cluster?
- Recommendation: the session is created with the `clusterId` of the frame that
  sent the first prompt (today's stores are already keyed by cluster id), and
  every tool request carries it. No cross-cluster tools in the first version.

Q3. What happens when the cluster is disconnected, or no frame answers?
- Recommendation: the tool returns an error result to the model (not a thrown
  error) such as "Cluster not connected", with a per-call timeout (30 s; logs
  maybe longer) so a closed frame cannot hang the loop.
