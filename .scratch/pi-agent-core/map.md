# Map: pi agent core

Label: wayfinder:map

## Destination

A buildable spec, handed to `/to-spec` and `/to-tickets`: one pi agent running in
the extension main process on the `pi-coding-agent` SDK, with the cluster tools
and approvals, streaming into the existing chat UI over IPC, on any pi built-in
provider plus custom OpenAI-compatible ones, with chats saved as pi JSON
sessions, and no LangChain/LangGraph left.

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
  pi built-in API-key provider plus custom OpenAI-compatible ones.
- [Freelens main-process API for cluster access and IPC](issues/07-research-freelens-main-api.md):
  main can list clusters and do CRUD per cluster id via `Main.K8s` (no pod
  logs); main-to-renderer IPC is broadcast-only; `getExtensionFileFolder()`
  gives a session folder.

## Not yet specified

- **The single agent's system prompt and tool set.** Today the prompts are
  split across analyzer, conclusions, general-purpose and kubernetes-operator
  agents. Merging them depends on the tool execution and IPC decisions.
- **Tool schemas.** The tools use zod; pi tools use typebox. Whether to
  rewrite schemas or convert them, and where the pure helpers
  (`field-filter`, `project-resource`, `resource-handlers`) end up.
- **What happens to the LangChain-era helpers:** `leaked-tool-calls`,
  `dsml-aware-chat-model`, `offline-token-chat-model`, `runnable-context`,
  `model-capabilities`, LiteLLM pricing and the token-usage UI. Some may be
  covered by pi (cost per message, reasoning effort), some may still be needed.
- **AI Explain** (`src/renderer/business/service/ai-analysis-service.tsx`) and
  session compaction (`session-compaction-service.ts`) also call `getModel()`.
  Whether they move to main on pi, or keep a thin renderer path.
- **Fate of the local AI proxy** (`src/main/ai-proxy-server.ts`) once keys live
  in main next to pi.
- **Build order and LangChain removal**, i.e. how the spec slices into tracer
  bullets. Settled by `/to-tickets`, after the map is clear.

## Out of scope

- Multi-agent / supervisor routing: one agent for now; may return later via a
  pi sub-agents extension.
- MCP: may return later via a pi extension. `mcp-agent.ts` is deleted, not
  ported.
- Converting existing LangGraph checkpoints: see
  [Existing saved chats](issues/03-existing-saved-chats.md).
- OAuth / subscription provider logins: later, as pi extensions or auth
  features; the first version is API-key providers plus custom ones.
