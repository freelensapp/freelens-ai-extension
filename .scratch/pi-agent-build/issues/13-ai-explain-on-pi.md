# 13: AI Explain on pi in main

**What to build:** "AI Explain" on a resource or event sends an `explain`
command; main runs a one-shot pi call with no tools and the explain system
prompt (Summary, Diagnosis, Impact, Recommended Actions, Reference, plain
headings without emoji, plus the user's custom agent rules). The answer
streams into the chat as normal `event` envelopes under its own `sessionId`
and is not saved into the cluster's session, so it does not grow the agent's
context.

**Blocked by:** 02

**Status:** resolved (HITL check pending)

- [x] `explain` streams events under a session id different from the chat's,
      and the cluster's session file is unchanged afterwards.
- [x] The explain prompt has the five sections without emoji and includes the
      custom agent rules when set.
- [x] The explain call has no tools.
- [x] Explain is refused with `success: false` while a chat run is going, as
      the input is.
- [x] Agent host tests cover the separate session id, the unchanged session
      file and the rules section.
- [ ] HITL: AI Explain on a failing pod streams a structured answer.

## Answer

- `src/main/agent/agent-host.ts`: the `explain` command runs a throwaway pi
  session (`SessionManager.inMemory`, `EXPLAIN_PROMPT` plus the custom agent
  rules in a `<user_rules>` block, no tools, the chat's picked model and the
  global thinking level). Its events go out as `event` envelopes under its own
  `sessionId`, on the cluster's shared `seq`. Nothing is written to disk.
- Explain is refused while a chat run is going or starting, or another
  explanation runs; a chat prompt is refused while an explanation runs. Stop
  and New chat stop it, also while pi is still starting it. A snapshot reports
  it as running (so a remounted frame keeps Stop) only between `agent_start`
  and `agent_settled`, and leaves its partial answer out.
- A provider error after an explanation retries it as an explanation.
- Removed: `ai-analysis-service.tsx`, `chat-readiness.ts`,
  `ANALYSIS_PROMPT_TEMPLATE`, the main process copy of pi's OpenAI key for the
  proxy, the chat picker syncing `selectedModel` for AI Explain, and the "AI
  Explain" Base URL and key fields on the settings page. The old
  `openAIBaseUrl` and `openAIKey` values stay in the preferences for ticket 11
  to import.

Known gaps:

- An explanation is not in the pi session, so it disappears when the chat is
  rebuilt from a snapshot that has chat messages (remount, restart). A frame
  that remounts mid-explanation also loses the rest of that answer.
- `openai-fields.ts`'s `explainReasoningOptions` is now read only by the old
  LangChain client; ticket 14 deletes both.
