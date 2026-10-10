# 13: AI Explain on pi in main

**What to build:** "AI Explain" on a resource or event sends an `explain`
command; main runs a one-shot pi call with no tools and the explain system
prompt (Summary, Diagnosis, Impact, Recommended Actions, Reference, plain
headings without emoji, plus the user's custom agent rules). The answer
streams into the chat as normal `event` envelopes under its own `sessionId`
and is not saved into the cluster's session, so it does not grow the agent's
context.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `explain` streams events under a session id different from the chat's,
      and the cluster's session file is unchanged afterwards.
- [ ] The explain prompt has the five sections without emoji and includes the
      custom agent rules when set.
- [ ] The explain call has no tools.
- [ ] Explain is refused with `success: false` while a chat run is going, as
      the input is.
- [ ] Agent host tests cover the separate session id, the unchanged session
      file and the rules section.
- [ ] HITL: AI Explain on a failing pod streams a structured answer.
