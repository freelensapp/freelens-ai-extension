# 02: Stop, disabled input and a chat that survives remounts and restarts

**What to build:** the user controls a run and never loses it. While a run is
going the input is disabled and a Stop button aborts it. Closing and reopening
the cluster window, even mid-run, shows the same chat with the partial answer;
restarting Freelens shows the saved chat. Provider errors and pi's automatic
retries show in the transcript. Tool calls get a timeout and a clear error when
the frame does not answer or the cluster is disconnected.

**Blocked by:** 01

**Status:** resolved (HITL check pending)

- [x] `abort` stops the run; the Stop button is visible only while a run is
      going, and the input is disabled until the run settles.
- [x] `get_snapshot` returns `{ messages, streamingMessage?, isStreaming,
      pendingToolRequests, pendingUiRequest?, autoApprove, seq }` (the last
      two can be empty until tickets 05 and 07 fill them); the frame applies
      only envelopes with a higher `seq` (tested in the chat client reduction,
      including a gap and a remount mid-stream).
- [x] After a Freelens restart, opening the cluster's chat rebuilds the
      transcript from the active session file.
- [x] A tool request with no answer times out after about 30 s (logs longer)
      and the model sees an error result; a disconnected cluster gives the
      error "Cluster not connected" instead of throwing (tested at the agent
      host with a frame that never answers).
- [x] A provider error (`errorMessage` on the assistant message) and pi's
      `auto_retry_start/end` show as lines in the transcript.
- [x] The session listener never awaits the renderer (a slow `broadcast` does
      not delay the loop in a host test).
- [ ] HITL: start a long answer, close and reopen the cluster window, and see
      the partial answer continue; press Stop and see the run end.

## Answer

Built on `piagent`. Everything except the HITL check is done and covered by
tests at the agreed seams.

**Agent host (`src/main/agent/agent-host.ts`):**

- `abort` first fails the cluster's tool calls still waiting on the frame
  ("The user stopped the run."), then awaits `session.abort()`. pi ends the run
  with `agent_settled` as usual. Answers `success: true` when nothing runs.
- `get_snapshot` returns the `AgentSnapshot` from `src/common/agent-protocol.ts`.
  `messages` holds only user and assistant messages (no system prompt, no tool
  results). `seq` is read after the session is opened, together with its
  state. For a cluster that has no session file and no live session it
  answers an empty snapshot without creating files; otherwise it opens the
  latest session file with no model, and the next prompt sets the model.
- `seq` now counts per cluster in the host, not per session object, so a
  snapshot before the first run reports 0.
- `broadcast` is called fire-and-forget inside a `try`: a throwing or
  never-completing broadcast does not affect the run (two host tests).

**Frame (`src/renderer/business/agent-client/`):**

- At frame start the client asks for a snapshot and buffers envelopes while it
  waits; afterwards it applies only the buffered envelopes newer than the
  snapshot's `seq`. A gap in `seq` marks the chat stale and fetches a new
  snapshot. Tool requests listed in a snapshot are answered, and a frame never
  runs the same request id twice.
- When the snapshot has no messages (no saved session yet) the frame keeps its
  transcript, so a refused prompt and its error stay visible.
- `chatFromSnapshot` (pure, tested) rebuilds the transcript: turns with only
  tool calls are skipped, saved errors keep their Retry button, an aborted
  answer is followed by a "Stopped." notice, and a partial answer continues
  from later deltas.
- The reducer tracks `isRunning` (from `agent_start` to `agent_settled`). It
  shows a `notice` line for a stopped run, and for `auto_retry_start` it
  replaces the error line just shown with "Provider error: ... Retrying in N s
  (attempt a of m)." If retries run out, the final error shows with Retry.
- The tool runner replies "Cluster not connected" without running the tool
  when `Renderer.Catalog.getClusterById(clusterId).status` is not
  `connected`. On hosts without that API the call just runs.

**Chat UI:** the textarea is disabled while a run is going, and Send is
replaced by a Stop button (`isAgentRunning`, `stopAgent` in the application
context). Notices render as dimmed italic lines.

**Known gaps until later tickets:**

- A snapshot from a saved session replaces the frame's transcript, so AI
  Explain answers (still LangChain, not in the pi session) disappear when the
  cluster window reopens or Freelens restarts (ticket 13).
- "Clear chat" still does not start a new pi session, so after a restart the
  cleared chat comes back from the session file (ticket 06).
- If a prompt is refused before any run (no model, no key), that user message
  and its error are not in the pi session and disappear once a later
  snapshot rebuilds the chat from it.

**HITL check (for the maintainer):** `pnpm pack:dev`, install the `.tgz`, ask
for a long answer, close and reopen the cluster window mid-answer and see it
continue; press Stop and see "Stopped." with the input enabled again; restart
Freelens and see the chat rebuilt.
