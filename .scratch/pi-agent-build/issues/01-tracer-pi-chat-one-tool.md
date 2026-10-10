# 01: Tracer: a pi agent in main answers the chat with one cluster tool

**What to build:** the thinnest end-to-end path through every layer. A user
types a question in the existing chat of a cluster window; the prompt goes to
main over IPC; one pi `AgentSession` for that cluster runs on the user's
existing OpenAI key; it can call `getClusterVersion`, which main sends to the
frame as a `tool_request` and the frame answers from today's tool code; the
answer streams back as `event` envelopes and renders in the chat; the chat is
written to a JSONL session file. The old LangChain path stays in the code but
the chat no longer uses it.

This ticket creates the three seams the spec relies on: the agent host in
main (commands in, envelopes out, host-free), the shared tool definition in
common (typebox, one tool for now), and the chat client reduction in the
renderer. It also sets the custom system prompt placeholder with pi's built-in
file and shell tools off, so the agent never gets them, even in this slice.

Credentials for this slice: `ModelRuntime` with `auth.json` and `models.json`
under the extension folder, plus the part of the one-time import that turns a
non-empty `openAIKey` (default base URL) into an `openai` key and seeds the
last used model from `selectedModel`. Custom base URLs are ticket 11.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] pi-coding-agent runs in the main bundle, `registerBunOAuthFlows()` is
      called at startup, and `pnpm build` and `pnpm build:production` pass.
- [ ] The agent host exposes `handleCommand(clusterId, command)` and an
      injected `broadcast`, imports nothing from the Freelens host, and is
      tested under vitest with pi-ai's faux provider: a `prompt` produces
      `event` envelopes with increasing `seq`, and a faux tool call produces a
      `tool_request` that resolves from a `tool_result` command.
- [ ] Envelopes have the shape `{ clusterId, sessionId, seq, kind, payload }`,
      events are pi's JSON form without `partial`, and `entry_appended` is not
      forwarded.
- [ ] A frame ignores envelopes for other clusters (tested in the chat client
      reduction).
- [ ] pi's built-in tools, context files, skills and prompt templates are off;
      the system prompt is ours.
- [ ] A `prompt` with no model or no credentials returns `success: false` and
      the chat shows the reason.
- [ ] The session file is written to `<extension folder>/sessions/<clusterId>/`.
- [ ] An upgrading user with only `openAIKey` set finds it in `auth.json`
      after the first start, and a marker stops the import from running twice.
      The old field is left in place, because AI Explain still runs on the old
      path until ticket 13; ticket 14 clears it.
- [ ] HITL: `pnpm pack:dev`, install the `.tgz` in a real Freelens 1.8 or
      later, ask "which Kubernetes version is this cluster?" with a real key,
      and see the answer stream in after a `getClusterVersion` call.
