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
