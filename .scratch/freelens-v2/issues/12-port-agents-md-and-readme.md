# 12: Port, step 7: AGENTS.md and README

**What to build:** the next person to change the extension, human or agent,
starts from an accurate description of it.

- `AGENTS.md` keeps the `main` branch's v2 sections on the build, TypeScript,
  tests, lint, CI and the rules that fail silently, and describes the pi agent
  on v2: the agent host, the IPC protocol (ADR 0001), the cluster tools in the
  main process (ADR 0002), the Freelens HTTP client for model requests and its
  gaps. It describes the code as it is and tells no history.
- The README states the Freelens 2 requirement, the build, the install from
  the extension's directory and the development loop.
- Ticket 08 of the pi agent core map ("where cluster tools execute") points to
  ADR 0002, which reverses it.

**Blocked by:** 08 (port, step 6), 10 (write tools in the main process), 11
(model requests through the Freelens HTTP client).

**Status:** ready-for-agent

- [ ] Every command, file layout and rule `AGENTS.md` names exists and works
      as written.
- [ ] `AGENTS.md` no longer mentions the v1 toolchain, `tool_request`, the
      frame-side tools, LangChain or MCP as part of the extension.
- [ ] The README's install and development steps work on Freelens 2.
- [ ] The pi agent core ticket 08 links ADR 0002.
- [ ] Trunk passes on the changed Markdown; one commit, pushed.
