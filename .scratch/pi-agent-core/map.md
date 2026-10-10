# Map: pi agent core

Label: wayfinder:map

## Destination

A buildable spec, handed to `/to-spec` and `/to-tickets`: one pi agent running in
the extension main process on the `pi-coding-agent` SDK, with the cluster tools
and approvals, streaming into the existing chat UI over IPC, on any pi built-in
provider (API key or OAuth/subscription login) plus custom OpenAI-compatible
ones, with chats saved as pi JSON sessions, and no LangChain/LangGraph left.

## Notes

- Domain: Freelens extension (Electron main + per-cluster renderer frames).
  Today's core is LangChain/LangGraph in `src/renderer/business/agent/`.
- Primary source for pi facts: `docs/PI_AGENT_SDK_RESEARCH.md` (cited against
  `badlogic/pi-mono@86dfcee`, npm scope `@earendil-works/pi-*`, version 1.0.0).
- Standing preference: lean on what pi ships and maintains (sessions,
  compaction, providers, extension runner) rather than writing custom code. The
  reason for choosing pi is that MCP, sub-agents, OAuth and custom providers can
  be added later as pi extensions.
- Start simple: one agent, no supervisor.
- Grilling tickets: call the Skill tool for "grilling" and "domain-modeling".
  Record hard-to-reverse calls as ADRs.
- Tracker: local markdown (this directory). Tickets in `issues/`.

## Decisions so far

- [Destination](issues/01-destination.md): a buildable spec, not the finished
  replacement.
- [Where the agent runs](issues/02-where-agent-runs.md): main process with the
  `pi-coding-agent` SDK and an IPC bridge to the renderer.
- [Existing saved chats](issues/03-existing-saved-chats.md): clean break; old
  LangGraph checkpoints are not converted.
- [Where the map lives](issues/04-where-map-lives.md): local markdown under
  `.scratch/pi-agent-core/`.
- [Providers in the first version](issues/05-providers-first-version.md): every
  pi built-in provider, including OAuth/subscription logins, plus custom
  OpenAI-compatible ones.
- [Spike: pi-coding-agent in Freelens main](issues/06-spike-pi-in-main.md):
  pi bundles into our CJS main output and runs under Electron 39 (Freelens
  1.8). The tested session had inline tools, a blocking `tool_call` approval
  hook and JSONL sessions. OAuth flows need `registerBunOAuthFlows()` to load
  from the bundle. The production build is about 13 MB unpacked.
- [What pi replaces](issues/14-what-pi-replaces.md): anything pi already does
  is deleted, not ported: compaction, checkpoints, the model layer, LiteLLM
  pricing, the local AI proxy and the LangChain workarounds. Tools are
  rewritten on typebox. AI Explain moves to main on pi.
- [Freelens main-process API for cluster access and IPC](issues/07-research-freelens-main-api.md):
  main can list clusters and do CRUD per cluster id via `Main.K8s` (no pod
  logs, no subresources, and resource paths guessed from the kind, so some
  kinds are unreachable); main-to-renderer IPC is broadcast-only;
  `getExtensionFileFolder()` gives a session folder.
- [Where cluster tools execute](issues/08-where-cluster-tools-execute.md): in
  the renderer cluster frame, reusing today's tool code; main sends each call
  tagged `clusterId` + `requestId` and the frame replies over
  `Renderer.Ipc.invoke`. A chat is bound to its frame's cluster. Disconnects
  and timeouts (about 30 s) become error tool results. No tools without an
  open frame.
- [Session storage](issues/11-session-storage.md): one JSONL file per chat in
  `<extension folder>/sessions/<clusterId>/`, one active chat per cluster,
  pi's default compaction, both old stores deleted, transcript rebuilt from
  the session. Main prunes chats older than a retention period (default 30
  days, a preference) and the chat UI can delete a cluster's chats.
- [Turn limit](issues/13-turn-limit.md): no cap, pi's default behaviour. A
  Stop button calling `session.abort()` is required instead.
- [IPC event protocol](issues/09-ipc-event-protocol.md): pi's RPC shapes. Main
  broadcasts one envelope `{ clusterId, sessionId, seq, kind, payload }`
  (`event`, `stats`, `tool_request`, `ui_request`) and frames filter by
  cluster. The renderer sends `(clusterId, command)` on one `Main.Ipc.handle`
  channel: `prompt`, `abort`, `new_session`, `get_session_stats`,
  `get_snapshot`, `delete_sessions`, `tool_result`, `ui_response`, `explain`.
  Input is disabled mid-run; remounts restore from a snapshot plus `seq`;
  tokens, cost and context come from `SessionStats` in main; AI Explain
  streams under its own session id and is not saved.
- [Approvals over IPC](issues/10-approvals-over-ipc.md): the gate runs in
  main in pi's `tool_call` hook; main validates and prepares the manifest, the
  frame adds the backup YAML. Which tools ask is a per-tool setting with
  today's gated tools as defaults. Requests are pi's `confirm` plus an
  `approval` field; no timeout, Stop and New chat deny. A chat can switch to
  "approve all" (in memory, cleared by New chat and restart).
- [System prompt and tool set](issues/15-system-prompt-and-tool-set.md): one
  custom prompt in `src/main/` (pi's built-in tools, context files, skills and
  templates off) merged from the analyzer, operator and general-purpose
  prompts, with safety rules that hold under "approve all". Per-prompt
  `cluster` (name) and `user_rules` sections via `before_agent_start`. All
  twelve tools kept, defined once in `src/common/agent-tools/` with typebox
  schemas and `mutating` / `requiresApprovalByDefault` flags; mutating tools
  run sequentially. AI Explain keeps its five sections, without emoji, and
  gets the custom rules.
- [Provider, key and login settings](issues/12-provider-key-settings.md):
  credentials and custom providers live in pi's `auth.json` and `models.json`
  in the extension folder in main. The settings page shows connected providers
  as cards; "Add provider" runs one generic login dialog over IPC for API keys
  and OAuth alike. Custom OpenAI-compatible providers come from a form. The
  model is picked only in the chat; the thinking level is one global setting
  (default `medium`). Today's OpenAI key and base URL are imported once, and
  env-var keys show as connected.

## Open tickets

None. The map is clear; next is `/to-spec`.

## Not yet specified

- **Build order and LangChain removal**: how the spec slices into tracer
  bullets. `/to-tickets` settles this once the map is clear. The first slice
  should also cover the HITL part the spike left open: `pnpm pack:dev` with pi
  in `src/main`, installed in a real Freelens.

## Out of scope

- Multi-agent / supervisor routing: one agent for now; may return later via a
  pi sub-agents extension.
- MCP: may return later via a pi extension. `mcp-agent.ts` is deleted, not
  ported.
- Converting existing LangGraph checkpoints: see
  [Existing saved chats](issues/03-existing-saved-chats.md).
- Loading **file-based** pi extensions (installed from npm or `~/.pi`). From
  our CJS bundle, pi's jiti loader hits `import.meta.resolve` and
  `require.resolve("typebox")`, so only bundled inline extension factories
  work ([spike](issues/06-spike-pi-in-main.md)). When MCP or sub-agents come
  back, start with an inline factory, for example `createMcpExtension()`.
