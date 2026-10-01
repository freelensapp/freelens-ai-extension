# Approvals over IPC

Type: grilling
Status: open
Blocked by: 08, 09

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
- Whether pi-coding-agent's session API exposes the hook, or it must be wired
  through a pi extension.
