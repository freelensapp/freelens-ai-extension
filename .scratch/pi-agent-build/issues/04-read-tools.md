# 04: The read-only cluster tools

**What to build:** the agent can orient itself in the cluster and read any
resource. Five read tools join `getClusterVersion` from 01, each defined once
in common with a typebox schema and run in the frame: `getNamespaces`,
`getWarningEventsByNamespace` (renamed from `getEventsForNamespace`),
`listKubernetesResources`, `getKubernetesResource`. `getPodLogs` is a read
tool but asks for approval by default, so it ships with the gate in ticket 05.

**Blocked by:** 01

**Status:** resolved (HITL check pending)

- [x] Each tool exports `{ name, label, description, parameters,
      mutating: false, requiresApprovalByDefault: false }` from common; the
      tool guidance that today sits in prompts or zod descriptions is in the
      `description`.
- [x] The frame tool runner checks arguments against the same typebox schema
      before running and replies with an error text on a schema mismatch.
- [x] Kinds resolve through the cluster's API discovery as today, so CRDs and
      irregular plurals (for example `Gateway`) work.
- [x] The pure helpers the read tools use (`field-filter`,
      `project-resource`) move to common with their tests.
- [x] Frame tool runner tests over fake cluster APIs cover each tool, a schema
      rejection and a disconnected cluster.
- [x] Read tools run in parallel (not `sequential`).
- [ ] HITL: ask "what is failing in namespace X?" and see the agent list
      resources and read warning events.

## Answer

- **Definitions** live in `src/common/agent-tools/`: `namespaces.ts`,
  `warning-events.ts` and `kubernetes-resources.ts` (list, get, and the shared
  `kind`, `apiVersion`, `includeManagedFields` and `fields` schemas that the
  write tools in 05 reuse). `AGENT_TOOLS` lists all five read tools, so main
  registers them with no change to the agent host; they are not `mutating`, so
  pi runs them in parallel.
- **Frame side:** `agent-client/cluster-tools.ts` holds the tool logic and
  reaches the cluster only through a small `ClusterReader` interface.
  `agent-client/freelens-cluster.ts` implements it on `Renderer.K8sApi`, and
  `getResourceApi` uses `apiManager.getApiByKind`, so kinds resolve through
  discovery as before. `cluster-tools.test.ts` drives each tool through
  `runToolRequest` with a fake `ClusterReader`.
- **Schema check:** `runToolRequest` now takes `{ definition, run }` per tool
  and runs `Value.Errors` from `typebox/value` (no code generation, so no CSP
  issue in the renderer) before calling the tool. A mismatch replies
  `Invalid arguments for <tool>: <errors>` as an error.
- **Moved to common:** `field-filter`, `project-resource` and the version
  summary (`cluster-version.ts`, now `version-summary.ts`), with their tests.
  `resolveApiVersion` stays in `resource-handlers.ts` until 05 moves that
  module to common.
- **Behavior changes against the LangChain tools:**
  - Warning events are now loaded for the namespace before they are read, so
    the tool no longer depends on what the UI has loaded.
  - A missing event store is an error, not an empty list that reads as "no
    warnings".
  - A failing cluster call is an error reply with the message (plain objects
    are JSON-encoded), instead of a successful reply holding
    `JSON.stringify(error)`.
- **The LangChain read tools** in `agent/tools/` now call the same
  `cluster-tools` functions, so the logic exists once until ticket 14 deletes
  them. They keep the registered name `getEventsForNamespace`.
- **Not done:** the Freelens adapter itself has no unit test (the agreed seam
  is the tool runner over fake cluster APIs); the HITL check is for the user.
- **HITL check:** `pnpm pack:dev`, install, ask "what is failing in namespace
  X?" in a cluster window. The agent should list resources and read warning
  events; Gateway API resources should be reachable with an explicit
  `apiVersion`.
