# IPC event protocol between main and the chat UI

Type: grilling
Status: open
Blocked by: 06, 07, 08

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
