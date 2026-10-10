# 04: The read-only cluster tools

**What to build:** the agent can orient itself in the cluster and read any
resource. Five read tools join `getClusterVersion` from 01, each defined once
in common with a typebox schema and run in the frame: `getNamespaces`,
`getWarningEventsByNamespace` (renamed from `getEventsForNamespace`),
`listKubernetesResources`, `getKubernetesResource`. `getPodLogs` is a read
tool but asks for approval by default, so it ships with the gate in ticket 05.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Each tool exports `{ name, label, description, parameters,
      mutating: false, requiresApprovalByDefault: false }` from common; the
      tool guidance that today sits in prompts or zod descriptions is in the
      `description`.
- [ ] The frame tool runner checks arguments against the same typebox schema
      before running and replies with an error text on a schema mismatch.
- [ ] Kinds resolve through the cluster's API discovery as today, so CRDs and
      irregular plurals (for example `Gateway`) work.
- [ ] The pure helpers the read tools use (`field-filter`,
      `project-resource`) move to common with their tests.
- [ ] Frame tool runner tests over fake cluster APIs cover each tool, a schema
      rejection and a disconnected cluster.
- [ ] Read tools run in parallel (not `sequential`).
- [ ] HITL: ask "what is failing in namespace X?" and see the agent list
      resources and read warning events.
