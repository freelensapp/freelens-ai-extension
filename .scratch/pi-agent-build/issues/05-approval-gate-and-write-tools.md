# 05: The approval gate, the write tools and pod logs

**What to build:** the agent can change the cluster, but only after the user
approves each change. The six mutating tools (`createKubernetesResource`,
`updateKubernetesResource`, `patchKubernetesResource`,
`deleteKubernetesResource`, `deletePod`, `restartKubernetesResource`) and
`getPodLogs` are registered. Main gates them in the inline extension's
`tool_call` hook: it validates and prepares the manifest, rejects an invalid
one without asking, writes the prepared manifest back into the tool input,
and sends a `ui_request` (pi's `confirm` plus the `approval` field). The
existing approval card renders it, with the backup YAML of the current
resource loaded by the frame, and answers with `ui_response`.

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [ ] Each tool is defined in common with its flags: the six write tools are
      `mutating: true` and `requiresApprovalByDefault: true`; `getPodLogs` is
      `mutating: false` and `requiresApprovalByDefault: true`.
- [ ] Mutating tools run with `executionMode: "sequential"`.
- [ ] `resource-handlers` moves to common with its tests and runs in main
      before the user is asked; an invalid manifest is blocked with its
      validation error and no `ui_request` is sent.
- [ ] The `ui_request` payload is `{ id, title, message, approval: { tool,
      kind, apiVersion, name, namespace } }`; the card shows the action YAML
      and, best effort, the current resource YAML.
- [ ] `{ id, confirmed: false }` blocks the call with "The user denied the
      action"; `{ id, confirmed: true }` runs it in the frame.
- [ ] The approval has no timeout; a pending approval is in `get_snapshot` and
      the card comes back on remount.
- [ ] Stop resolves a pending approval as denied and ends the run.
- [ ] Agent host tests cover approve, deny, invalid manifest, the prepared
      manifest reaching the `tool_request`, and abort while pending.
- [ ] HITL: ask the agent to scale a deployment, see the card with both YAML
      blocks, deny once and approve once.
