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

## Grilling round 1 (2026-10-05, awaiting answers)

Today: `ChatSessionStore` holds one session per cluster id (rendered
`MessageObject[]`, conversation id, token totals) and `AgentStateStore` holds
the LangGraph checkpoints, both as host-managed JSON files.

Q1. Where do session files live?
- Recommendation: `<getExtensionFileFolder()>/sessions/<clusterId>/`, one
  JSONL file per chat, through `SessionManager.create(cwd, sessionDir)`.

Q2. One chat per cluster, or a history list?
- Recommendation: **one active chat per cluster**, as today; "New chat" starts
  a new file and the old file is left on disk. A history picker is a later
  ticket, cheap because the files already exist.

Q3. Compaction settings and a manual button?
- Recommendation: pi's defaults, no settings, no "compact now" button in the
  first version. Show compaction as a line in the transcript when pi emits it.

Q4. What replaces the two stores?
- Recommendation: delete both. The renderer rebuilds the transcript from the
  session entries (loaded over IPC when a frame opens); token totals and cost
  are summed from the assistant messages' `usage`. No transcript HTML is stored.

Q5. Old store files on upgrade?
- Recommendation: leave them on disk and ignore them (no migration code, no
  deletion code); ticket 03 already settled the clean break.
