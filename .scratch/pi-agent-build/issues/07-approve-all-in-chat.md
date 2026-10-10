# 07: "Approve all in this chat"

**What to build:** the approval card gets a third button, "Approve all in this
chat". After it, no gated tool in that chat asks again, though manifests are
still validated. A notice "Approving all actions in this chat" shows with a
button to turn it off. The flag is held in memory in main per session and is
cleared by New chat, Delete all chats and restart. It replaces the old
`bypassApprovals` toggle.

**Blocked by:** 05, 06

**Status:** resolved (HITL check pending)

- [x] `ui_response` `{ id, confirmed: true, approveAll: true }` approves the
      pending call and turns on auto-approve for that session.
- [x] While on, gated calls skip the `ui_request` but still run validation, so
      an invalid manifest is still blocked.
- [x] `set_auto_approve { enabled: false }` turns it off; `get_snapshot`
      reports `autoApprove`, so a remounted chat shows the notice.
- [x] New chat, Delete all chats and a restart clear it.
- [x] Auto-approved calls still show as normal tool executions in the
      transcript.
- [x] `bypassApprovals` is no longer read by the chat (the field is deleted in
      ticket 14).
- [x] Agent host tests cover turning it on, skipping prompts, still blocking an
      invalid manifest, turning it off, and clearing on New chat.
- [ ] HITL: approve all, see the notice, see two changes run without a card,
      turn it off and see the next change ask again.

## Answer

Built in `src/main/agent/agent-host.ts`, with the chat side in
`chat-reducer.ts`, `agent-client.ts`, `application-context.tsx`, `chat.tsx`
and `message.tsx`.

- **Where the flag lives:** `autoApprove` on the cluster's in-memory
  `ClusterAgent`. New chat and Delete all chats dispose that object and a
  restart never had it, so all three clear the flag without extra code.
- **Turning it on:** a `ui_response` with `confirmed: true, approveAll: true`
  sets the flag before releasing the call, so the next gated call already
  skips the card. `approveAll` on a denial is ignored. If Stop or New chat
  denied the approval meanwhile, the answer fails and the flag stays off.
- **While on:** the `tool_call` hook still validates and prepares the
  manifest, so an invalid one is blocked with its error, then lets the call
  run without a `ui_request`. The call goes to the frame as a normal
  `tool_request` and emits the usual `tool_execution_*` events.
- **Turning it off:** `set_auto_approve { enabled: false }`. Only an approval
  answer turns it on, so the command type allows `false` only.
- **New envelope kind `auto_approve`** (`{ enabled }`), broadcast whenever the
  flag changes, so every frame's notice follows main. Ticket 09 did not list
  it. The snapshot's `autoApprove` covers a remount.
- **UI:** the card's third option is "Approve all in this chat". The notice
  "Approving all actions in this chat" with a Turn off button replaces the
  old "Bypass Approvals Mode" badge, and the old toggle button next to the
  input is gone. The legacy LangChain path no longer auto-approves either.

**Known gap:** if main restarted while a frame stayed open, the frame would
keep its old `autoApprove` until its next snapshot, so the notice could stay
up with the flag off in main. It can only err towards showing the notice.
