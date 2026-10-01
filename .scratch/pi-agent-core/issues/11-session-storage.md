# Session storage

Type: grilling
Status: open
Blocked by: 06, 07

## Question

How are chats persisted with pi's `SessionManager`?

- Where the JSONL session files live (extension storage folder?) and how they
  are named per cluster.
- One active session per cluster, or a list of past sessions per cluster.
- Compaction: pi's defaults (`reserveTokens` 16384, `keepRecentTokens` 20000)
  or tuned; automatic or user-triggered as today.
- What replaces `AgentStateStore` and `ChatSessionStore`. Can the chat UI be
  rebuilt from the session instead of storing transcript HTML?
- Clean break: delete the old store files on upgrade, or leave them.
