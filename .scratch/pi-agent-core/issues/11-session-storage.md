# Session storage

Type: grilling
Status: open
Blocked by:

## Question

How are chats persisted with pi's `SessionManager`?

- Where the JSONL session files live (extension storage folder?) and how they
  are named per cluster.
- One active session per cluster, or a list of past sessions per cluster.
- Compaction is pi's own (settled on the map; `session-compaction*.ts` is
  deleted). Open: keep pi's defaults (`reserveTokens` 16384,
  `keepRecentTokens` 20000) or tune them, and whether the chat UI exposes a
  manual "compact now".
- What replaces `AgentStateStore` and `ChatSessionStore`. Can the chat UI be
  rebuilt from the session instead of storing transcript HTML?
- Clean break: delete the old store files on upgrade, or leave them.

Spike fact ([06](06-spike-pi-in-main.md)): `SessionManager.create(cwd,
sessionDir)` from the CJS bundle in main wrote one JSONL file per session, with
10 entries for a prompt that made 2 tool calls.
