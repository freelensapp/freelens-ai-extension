# Freelens main-process API for cluster access and IPC

Type: research
Status: resolved
Blocked by:

## Question

What does the Freelens `Main` extension API offer the main process for:

1. reaching a given cluster's API server (catalog, kubeconfig path and context,
   cluster proxy, any `Main.K8sApi`);
2. IPC with the renderer cluster frames (`Main.Ipc` / `Renderer.Ipc`:
   handle/invoke/broadcast, namespacing, targeting one frame);
3. a per-extension storage directory for session files?

Cite the installed `@freelensapp/extensions` type definitions.

## Answer

Checked against the installed `@freelensapp/extensions` 1.10.1. Its
`dist/extension-api.d.ts:6-7` re-exports `@freelensapp/core`; paths below are
relative to that package's `static/build/library/src` (written `$L`).

1. **Cluster access: main can reach clusters itself.**
   - `Main` exposes `Ipc`, `LensExtension`, `Catalog`, `K8s`, `K8sApi`,
     `Navigation`, `Power` (`$L/extensions/main-api/index.d.ts:6-12`).
   - `Main.Catalog.getAllClusters()` and `getClusterById(id)`
     (`$L/extensions/main-api/catalog.d.ts:31,47`) return `ClusterInfo` with
     `id`, `kubeConfigPath`, `contextName`, `status`, `isActive`
     (`$L/extensions/common-api/cluster-types.d.ts:46-56`).
   - `Main.K8s` offers `queryCluster`, `queryClusters`, `queryAllClusters`,
     `getResource`, `applyOnCluster`, `deleteOnCluster`, `patchOnCluster`, all
     keyed by `clusterId` (`$L/extensions/main-api/k8s.d.ts:6-12`), routed
     through Freelens's own authenticated cluster proxy; a disconnected cluster
     returns 503 `ClusterNotAccessible` (`@freelensapp/core/static/build/library/main.js:4906-4960`).
   - Operations are list, get, create, update, patch, delete only
     (`$L/features/cluster/execute/common/types.d.ts:28`). **No pod logs, no
     exec.** Today `getPodLogs` uses `getLogs` in the renderer
     (`src/renderer/business/agent/tools/kubernetes-resource.ts:747`).
   - Whether `Main.K8sApi.forCluster` works in main for logs: unverified.
2. **IPC.**
   - Renderer to main: `Renderer.Ipc.invoke(channel, ...args): Promise`
     (`$L/extensions/ipc/ipc-renderer.d.ts:19,28`) against
     `Main.Ipc.handle(channel, handler)` (`$L/extensions/ipc/ipc-main.d.ts:18,24`).
   - Main to renderer: `broadcast(channel, ...args)` only, to every window and
     every cluster frame (`$L/extensions/ipc/ipc-registrar.d.ts:18`,
     `main.js:985-1010`). No way to target one frame, no request/response.
   - Channels are namespaced per extension (`main.js:2118,2126,2161,2183`).
   - The repo's current `ipc:broadcast-main` use
     (`src/renderer/navigation/navigate-to-extension-preferences.ts:18`) is an
     internal host channel outside the extension API; not a precedent to
     follow.
3. **Storage.** `getExtensionFileFolder(): Promise<string>` on the main
   extension class returns a pre-created per-extension folder
   (`$L/extensions/lens-extension.d.ts:37-44`,
   `$L/extensions/lens-main-extension.d.ts:20`). Suitable for JSONL sessions;
   the name is obfuscated, not secured.

Implications for later tickets:

- [Where cluster tools execute](08-where-cluster-tools-execute.md): `Main.K8s`
  makes running CRUD tools in main the natural option; pod logs are the gap.
- [IPC event protocol](09-ipc-event-protocol.md): main-to-renderer is
  broadcast-only, so every event must carry a cluster/session id and each frame
  filters; the renderer should send its cluster id with every command, since
  `ClusterInfo.isActive` is not frame-specific.
- [Session storage](11-session-storage.md): session files go under
  `getExtensionFileFolder()`.
