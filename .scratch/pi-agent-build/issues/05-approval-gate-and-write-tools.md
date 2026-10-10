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

**Status:** resolved (HITL check pending)

- [x] Each tool is defined in common with its flags: the six write tools are
      `mutating: true` and `requiresApprovalByDefault: true`; `getPodLogs` is
      `mutating: false` and `requiresApprovalByDefault: true`.
- [x] Mutating tools run with `executionMode: "sequential"`.
- [x] `resource-handlers` moves to common with its tests and runs in main
      before the user is asked; an invalid manifest is blocked with its
      validation error and no `ui_request` is sent.
- [x] The `ui_request` payload is `{ id, title, message, approval: { tool,
      kind, apiVersion, name, namespace } }`; the card shows the action YAML
      and, best effort, the current resource YAML.
- [x] `{ id, confirmed: false }` blocks the call with "The user denied the
      action"; `{ id, confirmed: true }` runs it in the frame.
- [x] The approval has no timeout; a pending approval is in `get_snapshot` and
      the card comes back on remount.
- [x] Stop resolves a pending approval as denied and ends the run.
- [x] Agent host tests cover approve, deny, invalid manifest, the prepared
      manifest reaching the `tool_request`, and abort while pending.
- [ ] HITL: ask the agent to scale a deployment, see the card with both YAML
      blocks, deny once and approve once.

## Answer

- **Definitions** live in `src/common/agent-tools/`: `write-tools.ts` (the six
  mutating tools) and `pod-logs-tool.ts`. `resource-handlers` and the
  `pod-logs` helpers moved there with their tests. `resource-handlers` still
  uses `zod` for its three manifest schemas; converting them to typebox can go
  with ticket 14.
- **The gate** is `AgentHost.gate`, registered with `pi.on("tool_call")`.
  `approval.ts` in common (`prepareApproval`) validates and prepares each
  call, builds the title (for example `PATCH DEPLOYMENT`) and the action YAML,
  and returns the input the frame will run. The hook replaces `event.input`
  in place with it, which pi passes on to `execute`. A blocked call becomes an
  error tool result with the reason. pi asks for one call at a time.
- **Which tools ask:** `AgentHostOptions.requiresApproval(tool)`, read before
  every call. Main passes the tool's `requiresApprovalByDefault`, except for
  `getPodLogs`, which follows the existing `podLogsRequireApproval`
  preference until ticket 08 replaces it with the per-tool list.
- **Protocol additions:** envelope kinds `ui_request` (payload
  `ApprovalRequest`: `{ id, toolCallId, method: "confirm", title, message,
  approval }`) and `ui_resolved` (`{ id, confirmed }`), the `ui_response`
  command, and `pendingUiRequest` in the snapshot. `ui_resolved` was not in
  ticket 09's list: the frame needs it to turn the card approved or denied,
  including when Stop or an abort from pi denies it.
- **Stop and aborts:** `abort` denies the cluster's pending approval before
  calling `session.abort()`, and the gate also listens to pi's abort signal,
  so a run aborted some other way never leaves the hook waiting. `dispose`
  denies every pending approval.
- **Frame side:** `cluster-tools.ts` runs the write tools and `getPodLogs`
  over the `Cluster` interface (renamed from `ClusterReader`; it now has
  `create`, `update`, `patch`, `remove` per resource API plus `deletePod`,
  `restartWorkload`, `getPodLogs` and `podLogsTailLines`).
  `freelens-cluster.ts` implements them on `Renderer.K8sApi` with the same
  calls as the LangChain tools, including the strategic merge patch for
  subresources such as `resize` and `scale`.
- **The card:** the reducer turns `ui_request` into the existing interrupt
  card (`approvalId`, `approvalTarget` on `MessageObject`), and `ui_resolved`
  marks it. The frame loads the current resource as the backup YAML once per
  card (not for create or pod logs). Its buttons send `ui_response`.

### Fixed after the code review

- **A change could run twice after a frame reload.** A write found only in a
  snapshot is no longer run again; the model gets "outcome unknown, check the
  resource". The tool timeout text also asks the model to check before
  retrying.
- **The gate ignored pi's abort signal.** Fixed as above.
- **Cards after a snapshot.** A rebuilt chat keeps the backup already loaded
  for the pending card, and closes as denied any other card still pending,
  such as one left over from before a restart.
- **Validation dropped manifest fields.** The zod schemas list only required
  fields, and their parsed output removed `labels`, `env`, `resources` and
  every other field, so an approved update could wipe them. This was already
  the case with the LangChain tools. A valid manifest now passes unchanged.
- **Create without a namespace** for a namespaced kind now asks for one, like
  update, patch and delete.

### Known gaps

- Resolved approval cards are not part of pi's session, so they disappear
  when the chat is rebuilt from a snapshot (remount after a missed envelope,
  restart). Tool calls are not shown in the chat either yet.
- An app restart drops a pending approval (accepted in the map, ticket 02).
- The old LangChain tools in `agent/tools/` and their `interrupt()` approvals
  are still in the code, unused by the pi chat, until ticket 14 deletes them.
