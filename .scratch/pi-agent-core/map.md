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
  logs); main-to-renderer IPC is broadcast-only; `getExtensionFileFolder()`
  gives a session folder.

## Not yet specified

- **The single agent's system prompt and tool set.** Today the prompts are
  split across the analyzer, conclusions, general-purpose and
  kubernetes-operator agents. Merging them depends on the tool execution and
  IPC decisions.
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
