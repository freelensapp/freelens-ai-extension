# 02: Stop, disabled input and a chat that survives remounts and restarts

**What to build:** the user controls a run and never loses it. While a run is
going the input is disabled and a Stop button aborts it. Closing and reopening
the cluster window, even mid-run, shows the same chat with the partial answer;
restarting Freelens shows the saved chat. Provider errors and pi's automatic
retries show in the transcript. Tool calls get a timeout and a clear error when
the frame does not answer or the cluster is disconnected.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `abort` stops the run; the Stop button is visible only while a run is
      going, and the input is disabled until the run settles.
- [ ] `get_snapshot` returns `{ messages, streamingMessage?, isStreaming,
      pendingToolRequests, pendingUiRequest?, autoApprove, seq }` (the last
      two can be empty until tickets 05 and 07 fill them); the frame applies
      only envelopes with a higher `seq` (tested in the chat client reduction,
      including a gap and a remount mid-stream).
- [ ] After a Freelens restart, opening the cluster's chat rebuilds the
      transcript from the active session file.
- [ ] A tool request with no answer times out after about 30 s (logs longer)
      and the model sees an error result; a disconnected cluster gives the
      error "Cluster not connected" instead of throwing (tested at the agent
      host with a frame that never answers).
- [ ] A provider error (`errorMessage` on the assistant message) and pi's
      `auto_retry_start/end` show as lines in the transcript.
- [ ] The session listener never awaits the renderer (a slow `broadcast` does
      not delay the loop in a host test).
- [ ] HITL: start a long answer, close and reopen the cluster window, and see
      the partial answer continue; press Stop and see the run end.
