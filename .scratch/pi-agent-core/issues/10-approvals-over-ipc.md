# Approvals over IPC

Type: grilling
Status: open
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
