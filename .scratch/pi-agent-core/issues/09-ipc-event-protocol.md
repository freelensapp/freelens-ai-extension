# IPC event protocol between main and the chat UI

Type: grilling
Status: open
Blocked by: 08

## Question

What crosses the main/renderer boundary, and in what shape?

- Which pi session events are forwarded (text deltas, thinking, tool
  start/update/end, usage and cost, errors, agent end) and which stay in main.
- Commands from the renderer: send prompt, abort, steer/follow-up, new chat,
  load history.
- Keying: one session per cluster (today's stores are keyed by cluster id),
  and how multiple open cluster frames are addressed.
- Backpressure: pi awaits `subscribe` listeners in order, so the bridge must
  not block the loop on renderer round-trips.

Spike fact ([06](06-spike-pi-in-main.md)): the events a prompt with tool calls
produced were `agent_start`, `turn_start/end`, `message_start/update/end`,
`tool_execution_start/end`, `agent_end` and `agent_settled`. Text arrives as
`message_update` with `assistantMessageEvent.type === "text_delta"`. Provider
errors arrive as `errorMessage` on the assistant message, not as a thrown
error.
