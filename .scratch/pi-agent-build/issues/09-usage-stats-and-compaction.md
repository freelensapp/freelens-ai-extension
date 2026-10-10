# 09: Tokens, cost, context gauge and the compaction notice from pi

**What to build:** the chat shows tokens used, cost and how full the context
is, all from pi's `SessionStats`, and a line in the transcript when pi
compacts the session. The renderer computes nothing.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Main broadcasts a `stats` envelope with `SessionStats` after each
      assistant `message_end` and at `agent_settled`; `get_session_stats`
      returns the same.
- [ ] The token counter, cost and the context gauge in the chat input read
      only from the latest `stats` (cost from pi's model catalog, context from
      `contextUsage`).
- [ ] `compaction_start/end` events show as a line in the transcript.
- [ ] Agent host test: a faux prompt produces a `stats` envelope with non-zero
      tokens; chat client reduction test: a `stats` envelope updates the view
      state.
- [ ] HITL: the counter and gauge move during a run with a real model.
