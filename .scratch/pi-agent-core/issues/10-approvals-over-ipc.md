# Approvals over IPC

Type: grilling
Status: claimed
Blocked by:

## Question

How does the approval for mutating tools work across processes?

The direction is settled (an awaiting `beforeToolCall`-style hook in main,
existing interrupt UI in the renderer, no survival across restart). Open:

- Which tools require approval (today: create, update, patch, delete, restart,
  pod delete) and where that list lives.
- What the renderer shows (today: the manifest and a backup of the current
  resource) and who computes it.
- Behaviour when the frame closes or the user never answers: deny, timeout, or
  abort the run.
- ~~Whether pi-coding-agent's session API exposes the hook, or it must be
  wired through a pi extension.~~ Answered by the spike
  ([06](06-spike-pi-in-main.md)): use an inline extension factory on
  `DefaultResourceLoader` with `pi.on("tool_call", handler)`. The handler can
  await, can return `{ block: true, reason }` (the model sees the reason), and
  can change `event.input` in place.

Settled inputs:

- [09](09-ipc-event-protocol.md): an approval goes to the frame as a
  `ui_request` envelope and comes back as a `ui_response` command. pi's own
  shape for this is `RpcExtensionUIRequest` (`confirm`, `select`, `input`,
  each with an `id` and optional `timeout`). A pending approval is part of the
  `get_snapshot` answer, so a remounted chat shows it again. The input is
  disabled during a run, so the approval UI is the only interaction besides
  Stop.
- [08](08-where-cluster-tools-execute.md): tool calls already go to the frame;
  the approval and the call are separate round-trips, both bound to the chat's
  cluster.

## Facts gathered

- Today the approval gate runs **inside** each write tool
  (`src/renderer/business/agent/tools/kubernetes-resource.ts:157`,
  `requestApproval`). Order per tool: resolve the kind, validate and prepare
  the manifest (`validateManifest`, `prepareManifest`), capture a best-effort
  YAML backup of the current resource (`captureResourceYaml`, `store.load`),
  then `interrupt()`. A denial returns the string "The user denied the
  action" as the tool result.
- Gated today: `createKubernetesResource` (no backup),
  `updateKubernetesResource`, `patchKubernetesResource`,
  `deleteKubernetesResource`, `deletePod`, `restartKubernetesResource`
  (always), and `getPodLogs` only when the `podLogsRequireApproval`
  preference is on (`PreferencesStore` lives in `src/common/store`).
- The approval UI (`src/renderer/components/interrupt/interrupt.tsx`) shows a
  header, a collapsible "Action details" YAML block, a collapsed "Resources
  that will be changed" backup block, and yes/no buttons.
- `resource-handlers.ts` (validation and manifest preparation) has no host
  imports, only `zod`, so it can run in main or move to `src/common/`.
- pi 1.0.0 `RpcExtensionUIRequest` `confirm` is `{ id, title, message,
  timeout? }` with a plain string message; the matching
  `RpcExtensionUIResponse` is `{ id, confirmed }` or `{ id, cancelled: true }`
  (`pi-coding-agent/dist/modes/rpc/rpc-types.d.ts:406-476`).

## Grilling round 1

Q1. Where does the gate run?
(a) In main, in the inline extension's `pi.on("tool_call")` hook, before the
`tool_request` goes to the frame. (b) In the renderer, inside the tool, as
today, as part of the single `tool_request` round-trip.
Recommendation: (a). The policy lives in one place next to pi, future tools
that run in main (MCP, pi extensions) get the same gate, a denial is pi's
native `{ block: true, reason }`, and the ~30 s tool timeout from 08 stays
meaningful because the human wait is no longer inside a tool call.

Q2. Which tools need approval, and where does that list live?
Recommendation: the six write tools always, `getPodLogs` when
`podLogsRequireApproval` is on, as today. Expressed as an approval flag on
each tool definition in `src/common/`, next to the shared schemas (ticket
15). The hook reads the flag and, for pod logs, the preference.

Q3. What does the approval show, and who computes it?
Recommendation: main validates and prepares the manifest in the hook (the
pure `resource-handlers` move to `src/common/`), rejects an invalid manifest
before asking, and writes the prepared manifest back into `event.input`, so
the user approves exactly what is applied. Main builds the action YAML. The
**frame** captures the backup YAML of the current resource when it renders
the approval, because only it has cluster access; best-effort as today, and
recomputed on remount.

Q4. Wire shape.
Recommendation: the `ui_request` payload is pi's `confirm` shape (`title` like
"UPDATE DEPLOYMENT", `message` = action YAML) plus one extra field,
`approval: { tool, kind, apiVersion, name, namespace }`, which the frame uses
for the structured view and the backup lookup. The `ui_response` is pi's
`{ id, confirmed }`.

Q5. Frame closed, or the user never answers.
Recommendation: no timeout. The pending approval waits in main and comes back
through `get_snapshot` when the chat is reopened. Stop (`abort`) and "New
chat" resolve it as denied and end the run. An app restart drops it
(accepted in 02).

Q6. What does a denial look like?
Recommendation: yes/no only in v1. The block reason the model sees stays "The
user denied the action". "Deny with a note" can come later with pi's `input`
request.

Q7. "Approve all for this chat" or auto-approve?
Recommendation: not in v1. Every gated call asks.
