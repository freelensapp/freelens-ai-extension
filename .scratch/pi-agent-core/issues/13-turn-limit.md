# Turn limit

Type: grilling
Status: resolved
Blocked by:

## Question

pi has no `maxTurns`. Do we cap the agent loop, and if so: what default, is it
configurable, where is it enforced (`finishTurn` in core, or whatever
pi-coding-agent's session exposes), and what does the user see when the cap is
hit?

The spike ([06](06-spike-pi-in-main.md)) showed an `AgentSession` emits
`turn_start`/`turn_end` per model turn, so an inline extension or the host can
count turns.

## Answer

No cap: keep pi's default behaviour. Decided by leo-capvano in PR #290
(2026-10-05), replacing the round 1 recommendation of 25 turns.

What pi does by default for long runs (installed `pi-coding-agent` 1.0.0):

- The loop runs until the model stops calling tools; there is no turn count.
- Transient provider errors are retried automatically (`retry.maxRetries` 3,
  `baseDelayMs` 2000, `settings-manager.js:662-664`).
- When the context approaches the model's limit, pi compacts automatically
  ([Session storage](11-session-storage.md)).
- The host can stop a run with `session.abort()`, and redirect it with
  `session.steer()` or queue `session.followUp()`.

What we lose: the 25-step stop that LangGraph's recursion limit gave us. A
model stuck in a loop of read-only tool calls (mutating calls already wait for
approval) runs until the user stops it. What that requires:

- A **Stop** button in the chat UI while a run is active, calling
  `session.abort()` in main. Today's UI has none, because the LangGraph limit
  made it less urgent. The abort command is part of
  [IPC event protocol](09-ipc-event-protocol.md).
- The running token and cost totals stay visible during the run, so a long run
  is noticeable.

If runaway runs show up in practice, a cap can be added later by counting
`turn_end` events in the host, as round 1 described.

## Grilling round 1 (2026-10-05)

Today there is no explicit cap in our code; LangGraph's default recursion limit
(25 graph steps) acts as one.

Q1. Cap the loop?
- Recommendation: **yes**, a default of 25 model turns per prompt, so a
  looping model cannot run up cost unnoticed.

Q2. Configurable?
- Recommendation: not in the first version; a constant in main. Add a
  preference only if users hit it.

Q3. Where enforced and what the user sees?
- Recommendation: count `turn_end` events per prompt in the host and call the
  session's abort when the cap is reached; the chat shows "Stopped after 25
  steps. Send a message to continue." The transcript stays usable, so
  "continue" is just another prompt.
