# 09: Tokens, cost, context gauge and the compaction notice from pi

**What to build:** the chat shows tokens used, cost and how full the context
is, all from pi's `SessionStats`, and a line in the transcript when pi
compacts the session. The renderer computes nothing.

**Blocked by:** 02

**Status:** resolved (HITL check pending)

- [x] Main broadcasts a `stats` envelope with `SessionStats` after each
      assistant `message_end` and at `agent_settled`; `get_session_stats`
      returns the same.
- [x] The token counter, cost and the context gauge in the chat input read
      only from the latest `stats` (cost from pi's model catalog, context from
      `contextUsage`).
- [x] `compaction_start/end` events show as a line in the transcript.
- [x] Agent host test: a faux prompt produces a `stats` envelope with non-zero
      tokens; chat client reduction test: a `stats` envelope updates the view
      state.
- [ ] HITL: the counter and gauge move during a run with a real model.

## Answer

- **When `stats` goes out.** pi computes `SessionStats` from the saved
  session entries, and saves a message synchronously right after
  `message_end` reaches its listeners. So main sends `stats` in a microtask
  after an assistant `message_end` (by then the message counts), at
  `agent_settled`, and after `compaction_end`. A failure to read the stats is
  logged and never breaks the run. AI Explain sends no stats: it is not part
  of the chat, so its tokens and cost are not in the counter.
- **Protocol.** New envelope kind `stats` (payload: pi's `SessionStats`), the
  `get_session_stats` command (no data for a cluster that never chatted, and
  no files created for it), and `stats` in `get_snapshot`.
- **Chat input.** The counter shows `in:X (cached:Y) + out:Z = $cost`, where
  `X` is pi's input plus cache reads and writes, `Y` the cache reads, and the
  cost pi's own total. The gauge fills from `contextUsage.tokens` over
  `contextUsage.contextWindow`; right after a compaction pi reports the size
  as unknown, and the tooltip says so until the next answer. Before any stats
  arrive, the gauge uses the picked model's context window.
- **Compaction line.** `compaction_start` adds "Compacting the conversation to
  free up context...", and `compaction_end` replaces it with the outcome
  (compacted, failed with pi's error, or stopped).
- **Found while testing:** after a compaction, `session.messages` holds only
  what the model still sees, so a snapshot rebuild (remount, missed
  envelopes, restart) dropped the earlier part of the chat. The snapshot now
  reads the saved entries (`sessionManager.getBranch()`) and puts a
  `{ role: "compaction" }` marker where each compaction happened; the chat
  rebuilds the compaction line from it.
- **Deleted:** the renderer's compaction (`session-compaction*.ts`), the
  LiteLLM pricing fetch (`model-pricing-provider.ts`), and the token, context
  and compaction state in `application-context.tsx`. The old LangChain path
  in `chat-service.ts` ignores its usage chunks until ticket 14 deletes it.
- **Left for ticket 14:** `computeSessionCost` and the `tokenUsage` /
  `lastInputTokens` fields of `ChatSessionStore` are unused now, and three
  comments still mention `model-pricing-provider.ts`.
- **Known gap:** after picking another model, the gauge keeps the previous
  model's context window until the next answer's stats arrive.
- **Tests:** agent host (8, pi's faux provider; two of them make pi compact
  for real with a small context window and lowered compaction settings), chat
  reducer (7).
