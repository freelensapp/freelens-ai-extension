# 07: "Approve all in this chat"

**What to build:** the approval card gets a third button, "Approve all in this
chat". After it, no gated tool in that chat asks again, though manifests are
still validated. A notice "Approving all actions in this chat" shows with a
button to turn it off. The flag is held in memory in main per session and is
cleared by New chat, Delete all chats and restart. It replaces the old
`bypassApprovals` toggle.

**Blocked by:** 05, 06

**Status:** ready-for-agent

- [ ] `ui_response` `{ id, confirmed: true, approveAll: true }` approves the
      pending call and turns on auto-approve for that session.
- [ ] While on, gated calls skip the `ui_request` but still run validation, so
      an invalid manifest is still blocked.
- [ ] `set_auto_approve { enabled: false }` turns it off; `get_snapshot`
      reports `autoApprove`, so a remounted chat shows the notice.
- [ ] New chat, Delete all chats and a restart clear it.
- [ ] Auto-approved calls still show as normal tool executions in the
      transcript.
- [ ] `bypassApprovals` is no longer read by the chat (the field is deleted in
      ticket 14).
- [ ] Agent host tests cover turning it on, skipping prompts, still blocking an
      invalid manifest, turning it off, and clearing on New chat.
- [ ] HITL: approve all, see the notice, see two changes run without a card,
      turn it off and see the next change ask again.
