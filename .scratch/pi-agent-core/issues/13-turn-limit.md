# Turn limit

Type: grilling
Status: open
Blocked by:

## Question

pi has no `maxTurns`. Do we cap the agent loop, and if so: what default, is it
configurable, where is it enforced (`finishTurn` in core, or whatever
pi-coding-agent's session exposes), and what does the user see when the cap is
hit?

The spike ([06](06-spike-pi-in-main.md)) showed an `AgentSession` emits
`turn_start`/`turn_end` per model turn, so an inline extension or the host can
count turns.

## Grilling round 1 (2026-10-05, awaiting answers)

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
