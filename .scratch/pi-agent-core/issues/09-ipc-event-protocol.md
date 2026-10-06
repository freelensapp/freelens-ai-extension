# IPC event protocol between main and the chat UI

Type: grilling
Status: claimed
Blocked by:

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

Settled inputs:

- [08](08-where-cluster-tools-execute.md): tool calls also cross this boundary,
  as main-to-frame requests tagged `clusterId` + `requestId` with frame replies
  through `Renderer.Ipc.invoke` and a per-call timeout. One envelope should
  serve events, tool requests and approvals.
- [11](11-session-storage.md): commands also include loading a cluster's
  session for transcript rebuild and "Delete all chats".
- [13](13-turn-limit.md): no turn cap, so **abort** (the Stop button) is a
  required command, not optional.

## Grilling round 1 (2026-10-06)

New facts (checked in the installed `@earendil-works/pi-coding-agent` 1.0.0;
paths are relative to its `dist/`):

- **pi already ships a wire protocol for embedding.** RPC mode
  (`modes/rpc/rpc-mode.d.ts:1-12`) is "headless operation" for "embedding the
  agent in other applications": `RpcCommand` in, `RpcResponse` and events out
  (`modes/rpc/rpc-types.d.ts:14-404`). `runRpcMode()` itself is tied to
  stdin/stdout, so it cannot run over Freelens IPC, but `RpcCommand`,
  `RpcResponse`, `RpcSessionState` and `JsonAgentSessionEvent` are exported
  types (`index.d.ts:35`).
- **Commands it defines** that we need: `prompt` (with
  `streamingBehavior: "steer" | "followUp"` while a run is going), `steer`,
  `follow_up`, `abort`, `new_session`, `get_state` (`isStreaming`,
  `isCompacting`, `sessionId`, ...), `get_messages`, `get_session_stats`,
  `set_model`, `set_thinking_level`.
- **Wire events strip the cumulative snapshot.** In-process, every
  `message_update` carries the whole partial assistant message so far.
  `JsonAgentSessionEvent` (`modes/json-event.d.ts:16-31`) drops that `partial`
  and keeps only the delta plus cumulative `usage`, because `message_start`
  gives the initial message and `message_end` the final one. `toJsonEvent()`
  does the stripping but is not exported from the package root, so we
  reimplement it (a few lines).
- **Session events beyond the agent loop** (`core/agent-session.d.ts:47-90`):
  `agent_end` (with `willRetry`), `agent_settled`, `queue_update`,
  `compaction_start/end`, `auto_retry_start/end`, `entry_appended`,
  `thinking_level_changed`.
- **Token, cost and context gauge come for free.** `SessionStats`
  (`core/agent-session.d.ts:190-207`) has `tokens`, `cost` and
  `contextUsage`. Today's `TokenUsageChunk` / `ContextSizeChunk` machinery in
  `src/renderer/business/service/agent-service.ts` goes.
- **Extension UI requests** (`RpcExtensionUIRequest`,
  `modes/rpc/rpc-types.d.ts:406-476`: `confirm`, `select`, `input`, `notify`,
  each with an `id` and optional `timeout`) are pi's own shape for "main needs
  an answer from the UI". Relevant to [approvals](10-approvals-over-ipc.md).
- Today's renderer consumes an `AsyncGenerator` of strings plus
  reasoning/usage/context/interrupt chunks (`agent-service.ts`,
  `src/common/service/chat-service.ts:245-296`).

Q1. Protocol vocabulary: pi's or ours?

- (a) Reuse pi's RPC shapes: a subset of `RpcCommand` renderer-to-main, and
  `JsonAgentSessionEvent` main-to-renderer, forwarded almost verbatim.
- (b) A Freelens-specific vocabulary like today's chunks (text, reasoning,
  usage, interrupt), translated in main.
- Recommendation: **(a)**. It is pi's maintained protocol for this exact case,
  it needs no translation layer, and events from future pi extensions (MCP,
  sub-agents) arrive in a shape the renderer already understands. The
  renderer's chat service is rewritten anyway, since today's chunks are
  LangChain-shaped.

Q2. Which events cross?

- Recommendation: every session event in its JSON form (no `partial`), except
  `entry_appended` (it duplicates `message_end` and can carry large tool
  results). The renderer ignores events it does not render. No batching of
  text deltas at first; add coalescing only if the UI lags.

Q3. Envelope and addressing.

- Recommendation: one broadcast channel from main with one envelope,
  `{ clusterId, sessionId, seq, kind, payload }`, where `kind` is `event`,
  `tool_request` ([08](08-where-cluster-tools-execute.md)) or `ui_request`
  ([10](10-approvals-over-ipc.md)). Each frame drops envelopes whose
  `clusterId` is not its own. `seq` increases per cluster, so a frame can
  order events and detect gaps.

Q4. Commands from the renderer.

- Recommendation: one `Main.Ipc.handle` channel taking `(clusterId, command)`,
  answered through the `invoke` promise in `RpcResponse` shape, so this
  direction needs no correlation id. v1 commands: `prompt`, `abort`,
  `new_session`, `get_snapshot` (Q6), `get_session_stats`, plus ours:
  `delete_sessions` ([11](11-session-storage.md)), `tool_result` (08) and
  `ui_response` (10). Errors before a run starts (no model, no key) come back
  as `success: false`; errors during the run arrive as events.

Q5. Typing while a run is going.

- (a) Input disabled until the run settles; Stop is the only action (today's
  behaviour).
- (b) A message sent mid-run is queued as a follow-up
  (`streamingBehavior: "followUp"`) and runs when the current one finishes.
- (c) As (b), plus a separate "steer" action that injects the message at the
  next turn.
- Recommendation: **(a)** for v1: closest to today, smallest UI change. (b)
  and (c) are one command away later.

Q6. A frame that opens or remounts mid-run.

- Recommendation: on mount the frame calls `get_snapshot`, answered with
  `{ messages, streamingMessage?, isStreaming, pendingToolRequests,
  pendingUiRequest?, seq }`; it then applies live envelopes with a higher
  `seq` and drops older ones. Main keeps the in-flight assistant message, so a
  remounted chat shows the partial answer instead of losing it.

Q7. Token, cost and context display.

- Recommendation: main broadcasts a `stats` envelope (`SessionStats`) after
  each assistant `message_end` and at `agent_settled`. The renderer shows
  tokens and cost from it and the context gauge from `contextUsage`. Nothing
  is computed in the renderer.

Q8. AI Explain.

- Today it is a separate LangChain chain whose answer streams into the chat
  (`src/renderer/business/service/ai-analysis-service.tsx`).
  [What pi replaces](14-what-pi-replaces.md) moves it to main as a single pi
  call with no tools.
- Recommendation: an `explain` command that streams back as normal `event`
  envelopes under its own `sessionId`, rendered in the chat but **not** saved
  into the cluster's pi session, so it does not grow the agent's context.
