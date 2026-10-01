# Research: replacing the agent core with the pi agent SDK

Status: research notes (input for `/wayfinder` decisions, not a decision record).
Date: 2026-10-01.

## Sources

All claims are cited against the pi monorepo source, which is the primary source
for the SDK:

- Repository: <https://github.com/badlogic/pi-mono>, commit
  `86dfceec402ad77e563bf4feab5f26c42d5f5db6` (2026-10-01).
- Citations use `packages/<pkg>/<path>:<line>` relative to that repository. To
  open one, prefix it with
  `https://github.com/badlogic/pi-mono/blob/86dfceec402ad77e563bf4feab5f26c42d5f5db6/`.
- Claims about this extension cite this repository's paths directly (for
  example `src/renderer/...`).

Packages relevant to us, all at `1.0.0` on npm (published 2026-10-01):

| Package                           | Role                                                           |
| --------------------------------- | -------------------------------------------------------------- |
| `@earendil-works/pi-ai`           | Unified LLM API: models, providers, streaming, usage and cost  |
| `@earendil-works/pi-agent-core`   | `Agent` class and agent loop (tools, hooks, events)            |
| `@earendil-works/pi-mcp`          | Standalone MCP client (stdio, Streamable HTTP)                 |
| `@earendil-works/pi-coding-agent` | CLI and Node SDK: sessions, compaction, extensions, MCP wiring |
| `@earendil-works/pi-durable`      | Experimental crash-safe conversation runtime                   |

Note on naming: the packages moved from the `@mariozechner/pi-*` scope (last
version `0.73.1`, May 2026) to `@earendil-works/pi-*`. Older blog posts and
examples use the old scope and the pre-1.0 API.

## Summary

- **The core loop is small and runtime-neutral.** `pi-agent-core` depends only
  on `pi-ai` and `typebox`, and has no Node imports in `src/`. In 1.0.0 the
  sessions, compaction and harness were removed from core
  (`packages/agent/CHANGELOG.md:9`).
- **Approvals map onto an async `beforeToolCall` hook** that can block a call
  with a reason. There is no checkpointed interrupt and resume like LangGraph's
  `interrupt()`. An approval is an awaited promise inside a live run.
- **There is no built-in multi-agent or supervisor runtime.** A sub-agent is a
  tool that runs another `Agent`.
- **MCP has first-party support again.** `pi-mcp` is a standalone client with a
  documented 15-line adapter to `AgentTool`. Legacy HTTP+SSE is not supported.
- **Persistence and compaction live in `pi-coding-agent`** (Node-only, ESM-only,
  heavy dependencies) or in the experimental `pi-durable`. Using core alone
  means we keep our own storage. The messages are plain JSON, so that is
  straightforward.
- **Providers fit our setup.** Custom models take a custom `baseUrl` and custom
  `headers`, so `x-upstream-base-url` keeps working. Reasoning effort is mapped
  for us and cost is computed per message. Temperature is not stripped for
  reasoning models.
- **The main open risk is packaging, not APIs.** `pi-ai` is ESM-only and uses
  `import.meta.url`, variable dynamic `import()` and JSON import attributes. Our
  renderer and main bundles are CJS. Only a build spike can settle this.

## Q1. Where it runs: renderer or main process

Facts about pi:

- `pi-agent-core` `src/` has no `node:`, `fs`, `child_process`, `process.` or
  `Buffer` usage. Its runtime dependencies are `pi-ai` and `typebox`
  (`packages/agent/package.json`). It still declares `engines.node >=22.19.0`.
- `pi-ai` says it supports browsers and that the core entry and provider
  factories are side-effect free (`packages/ai/README.md:1627-1652`). It
  hard-codes `dangerouslyAllowBrowser: true` for the OpenAI clients
  (`packages/ai/src/api/openai-responses.ts:296`,
  `packages/ai/src/api/openai-completions.ts:791`).
- API implementations are loaded lazily through dynamic `import()`
  (`packages/ai/src/api/lazy.ts:73-79`,
  `packages/ai/src/api/openai-responses.lazy.ts:4`).
- Node built-ins are reached only through guarded or variable-specifier imports:
  - `packages/ai/src/env-api-keys.ts:1-24`
  - `packages/ai/src/utils/pi-user-agent.ts:7-15`
  - `packages/ai/src/utils/provider-env.ts:34-70`
- OAuth flows are Node-only (`packages/ai/README.md:1651`). The Bedrock entry is
  Node-only (`packages/ai/src/bedrock-provider.ts:1`).
- `pi-ai` is ESM-only: `"type": "module"`, and its exports have only `types` and
  `import` conditions (`packages/ai/package.json`). The OAuth loader uses
  `import.meta.url` (`packages/ai/src/auth/oauth/load.ts:10`). The generated
  model catalogs import JSON with `with { type: "json" }`
  (`packages/ai/src/providers/openai.models.ts:4`).
- `pi-coding-agent` (sessions, compaction, extensions) is Node-only by design.
  It "embeds Pi in a Node.js or Bun process"
  (`packages/coding-agent/docs/sdk.md:3`) and imports `fs` and `readline`
  (`packages/coding-agent/src/core/session-manager.ts:28-30`).
- `pi-agent-core` ships `streamProxy`, a client for running the LLM call on a
  server and streaming the events back over SSE
  (`packages/agent/src/proxy.ts:1-3`, `:160-219`). The server side is not
  included.

Facts about this extension:

- The renderer bundle is built as a CJS "preload" library with Node built-ins
  external (`electron.vite.config.js:12`, `:61-72`). The renderer already uses
  Node:
  - `require("electron")` in
    `src/renderer/navigation/navigate-to-extension-preferences.ts:9`
  - `node:async_hooks` in `src/renderer/business/agent/runnable-context.ts:23`
  - stdio MCP servers through `@langchain/mcp-adapters` in
    `src/renderer/business/agent/mcp-agent.ts:38`
- Bundled dependencies (everything except the host globals) are compiled into
  our CJS output. Being ESM-only is therefore not a blocker in itself. The open
  question is how rolldown's CJS output handles `import.meta.url` and
  variable-specifier `import()` in pi-ai.

Implication: both placements look technically possible.

- **Renderer.** The smallest change. It keeps the existing UI, stores and
  approval UI in one process, and works with `pi-agent-core` plus `pi-ai`.
- **Main process.** Needed if we want `pi-coding-agent` (`SessionManager`,
  compaction, the extension runner). It needs an IPC event bridge to the
  renderer.

Either way, step one is a build spike that bundles `pi-ai` and `pi-agent-core`
into `out/renderer` and streams one completion.

## Q2. Multi-agent: keep the supervisor or collapse it

- `pi-agent-core` has no sub-agent or supervisor construct. The package "now
  contains only `Agent`, the agent loop, the proxy stream, and their types"
  (`packages/agent/CHANGELOG.md:9`, `packages/agent/src/index.ts:1-5`).
- Nested tool calls go through `runToolCall`, so hooks such as approvals also
  apply to tools called from inside other tools
  (`packages/agent/src/agent-loop.ts:801-818`).
- The coding-agent has a sub-agent example only. It spawns a separate `pi`
  process per sub-agent
  (`packages/coding-agent/examples/extensions/subagent/README.md:3-31`), which
  does not fit an Electron extension.
- `pi-durable` documents a `subagent` tool pattern
  (`packages/durable/README.md:397-419`), but the package is experimental.
- The model and thinking level can be switched per turn through
  `prepareRequest` and `prepareNextTurn`
  (`packages/agent/src/agent-loop.ts:186-199`, `:219-239`;
  `packages/agent/src/types.ts:161-189`). The tool set can also change between
  turns: the loop injects a system message listing added and removed tools
  (`packages/agent/src/agent-loop.ts:333-363`).

Implication: keeping today's topology (supervisor routing across analyzer,
conclusions, general-purpose, kubernetes-operator and MCP agents) means
building it ourselves, as "delegate" tools that each run a child `Agent`. The
idiomatic pi shape is one agent with the full toolset and a good system prompt.
Per-turn model and tool switching covers some of what routing does today.

## Q3. MCP

- `@earendil-works/pi-mcp` is a standalone MCP client with no dependency on the
  official MCP SDK (`packages/mcp/README.md:3`). Its only runtime dependency is
  `cross-spawn` (`packages/mcp/package.json:51-56`).
- **Transports:** stdio and Streamable HTTP (sessions, server-to-client GET
  stream, `Last-Event-ID` resumption), plus in-memory for tests
  (`packages/mcp/README.md:5`, `:125`; `packages/mcp/src/index.ts:58-65`).
- **Not supported:** legacy HTTP+SSE, sampling and tasks
  (`packages/mcp/README.md:132`).
- **API:**
  - `McpClient.connect`, `listTools` (paginated), `callTool(name, args, {signal})`,
    `listResources`, `readResource`, `onNotification` and `close`
    (`packages/mcp/src/client.ts:202-386`).
  - OAuth with PKCE and dynamic client registration under `/oauth`
    (`packages/mcp/README.md:58-110`).
- **Adapter:** `toLlmContent(result)` plus a roughly 15-line adapter maps MCP
  tools to `AgentTool[]` (`packages/mcp/README.md:30-54`).
- **Node-only part:** `StdioTransport` imports `node:child_process` and
  `cross-spawn` (`packages/mcp/src/transports/stdio.ts:1-3`). That matches what
  we already do in the renderer today.
- **How the coding-agent wires it:** as a built-in extension since 0.99.0
  (`packages/coding-agent/CHANGELOG.md:109-121`). Tools are named
  `mcp__<server>__<tool>`, and exposure modes are codemode (default), deferred,
  direct and hidden (`packages/coding-agent/src/core/mcp-servers.ts:8-17`).

Implication: the MCP agent can become a set of MCP-backed tools on the main
agent, with approvals through the same `beforeToolCall` hook. One check before
deciding: whether any user `mcpServers` configuration relies on legacy SSE,
which `@langchain/mcp-adapters` supports today.

## Q4. Approval flow (replacing LangGraph `interrupt()`)

How LangGraph is used today: write tools call `interrupt()` and the UI resumes
the graph with a `Command`:

- `src/renderer/business/agent/tools/kubernetes-resource.ts:174`
- `src/renderer/business/agent/mcp-agent.ts:68`
- `src/renderer/business/agent/runnable-context.ts:4-12`

What pi offers:

- **`beforeToolCall(ctx, signal)`** is async. It gets
  `{ assistantMessage, toolCall, args, context }`, with `args` already
  validated (`packages/agent/src/types.ts:107-116`, `:326`).
  - It can return only `{ block?, reason?, terminate? }`
    (`packages/agent/src/types.ts:66-74`).
  - A block becomes an error tool result carrying `reason`
    (`packages/agent/src/agent-loop.ts:744-754`).
  - It cannot rewrite the arguments. Only `prepareArguments` can, and that runs
    before validation (`packages/agent/src/agent-loop.ts:693-705`).
- **`afterToolCall`** can replace `content`, `details`, `isError` and
  `terminate` (`packages/agent/src/types.ts:92-104`).
- **Tool annotations.** The coding-agent extension API has `tool_call` events
  that can block or modify input, and it lets annotations such as
  `destructiveHint` decide what needs confirmation
  (`packages/coding-agent/docs/extensions.md:105`, `:166-175`). The example
  gate uses `ctx.ui.select`
  (`packages/coding-agent/examples/extensions/permission-gate.ts:13-30`).
- **No checkpointed pause.** There is no `interrupt()` equivalent. The pattern
  is to await a UI promise inside `beforeToolCall` while the run stays live. The
  other option is to end the run (`finishTurn` returning `{action: "end"}`, or
  `terminate`) and later call `continue()` on the same transcript
  (`packages/agent/src/agent.ts:384-411`).
- **Parallel tool calls.** Tools run in parallel by default, but preflight
  (validation plus `beforeToolCall`) runs sequentially
  (`packages/agent/src/agent-loop.ts:596-648`). Approvals are therefore asked
  one at a time, in order.

Implication: our approval UI can stay the same. Only its trigger changes, from
interrupt state on the graph to an approval promise that `beforeToolCall`
awaits. One behavior is lost: a pending approval no longer survives an app
restart, because LangGraph checkpoints persisted the interrupt. `pi-durable`
can recover from a crash (`packages/durable/README.md:166`), but it is
experimental.

## Q5. Persistence and existing saved chats

- **`pi-agent-core` has no persistence** (`packages/agent/CHANGELOG.md:9`).
  - `AgentState` holds the system prompt, model, thinking level, tools,
    messages and streaming state (`packages/agent/src/types.ts:382-421`).
  - Messages are plain object literals
    (`packages/agent/src/agent-loop.ts:922-935`). `pi-ai` documents that
    contexts can go through `JSON.stringify` (`packages/ai/README.md:1592-1623`).
  - Tool `details` are typed `any`, so whether they serialize depends on our
    tools (`packages/agent/src/types.ts:428`).
- **The system prompt and tool declarations are system messages in the
  transcript** (`packages/agent/src/agent.ts:85-86`,
  `packages/agent/src/agent-loop.ts:333-363`).
  - The README's `convertToLlm` example filters out system messages
    (`packages/agent/README.md:541`). Copying it would drop the system prompt.
  - Keep the default converter (`packages/agent/src/agent.ts:38-46`).
- **Custom message types** are added by declaration merging on
  `CustomAgentMessages` (`packages/agent/src/types.ts:365-374`). Examples: an
  approval record or a compaction summary.
- **`pi-coding-agent` `SessionManager`** stores JSONL tree-structured sessions
  (`packages/coding-agent/docs/session-format.md:3-31`).
  `SessionManager.inMemory(cwd, options, entries?)` can rehydrate from entries
  held outside the filesystem
  (`packages/coding-agent/src/core/session-manager.ts:1755-1815`). It is
  Node-only.
- **`pi-durable`** offers Memory, SQLite and JSONL stores
  (`packages/durable/README.md:519-527`). It is marked "Experimental. The API
  changes without notice" (`packages/durable/README.md:3`), and it uses its own
  `Harness` instead of `pi-agent-core` (`packages/durable/README.md:7`).

Today chats are LangGraph checkpoints stored in the host `AgentStateStore`
(`src/renderer/business/agent/persistent-memory-saver.ts:17-22`).

Implication: the cheapest path is to store `AgentMessage[]` per chat in the
existing `AgentStateStore` and feed it back into `Agent` state. Existing
checkpoints would need a one-off conversion from LangChain messages to pi
messages, or a clean break with a notice. That is a product decision for
wayfinder.

## Q6. Providers, reasoning effort, proxy and pricing

**Custom models**

- A custom model is a plain `Model` object registered through `createProvider`
  (`packages/ai/src/models.ts:989-1034`; example at
  `packages/ai/README.md:1215-1247`).
  - Fields include `id`, `api`, `provider`, `baseUrl`, `headers`, `reasoning`,
    `cost`, `contextWindow`, `maxTokens` and `compat`
    (`packages/ai/src/types.ts:1097-1142`).
  - `auth` is required. A keyless resolver is allowed
    (`packages/ai/README.md:1236`).
- **APIs:** `openai-responses` and `openai-completions` are among the known APIs
  (`packages/ai/src/types.ts:17-29`). The built-in OpenAI provider uses
  `openai-responses` (`packages/ai/src/providers/openai.ts:7-23`).

**Proxy header**

- Headers are merged in this order: auth headers, `model.headers`,
  `options.headers`, `transformHeaders` (`packages/ai/README.md:421`;
  `packages/ai/src/models.ts:746-753`, `:860-861`;
  `packages/ai/src/api/openai-responses.ts:268-290`).
- So `x-upstream-base-url` can be set on the model or per request, with
  `baseUrl` pointing at our local proxy (`src/main/ai-proxy-server.ts`).
- `options.fetch` can be injected (`packages/ai/src/types.ts:137-143`).

**Reasoning effort**

- `ThinkingLevel` is `minimal | low | medium | high | xhigh | max`
  (`packages/ai/src/types.ts:85-87`).
  - The level is clamped to what the model supports.
  - `xhigh` and `max` need a `thinkingLevelMap` entry
    (`packages/ai/src/models.ts:1217-1250`).
- On Responses, reasoning models get `reasoning: { effort, summary: "auto" }`
  and encrypted reasoning content
  (`packages/ai/src/api/openai-responses.ts:363-378`).
- On Completions, `reasoning_effort` is sent only when
  `compat.supportsReasoningEffort` is set
  (`packages/ai/src/api/openai-completions.ts:964-971`).
- Compat flags for OpenAI-compatible servers are detected from `baseUrl` and
  `provider` unless set explicitly
  (`packages/ai/src/api/openai-completions.ts:1585-1620`). A localhost proxy URL
  falls back to standard OpenAI behavior, so we should set `compat` explicitly
  for custom endpoints.
- At the agent level, `thinkingLevel` (`"off"` through `"max"`) maps onto
  `reasoning`, with `"off"` becoming `undefined`
  (`packages/agent/src/agent.ts:471`).

**Temperature**

- Not stripped for reasoning models. It is sent whenever it is defined
  (`packages/ai/src/api/openai-responses.ts:344-346`,
  `packages/ai/src/api/openai-completions.ts:846-848`).
- Our `model-capabilities.ts` heuristic stays useful: it decides whether to
  pass `temperature` at all.

**Usage and cost**

- `Usage` includes `input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`,
  `totalTokens` and a `cost` breakdown (`packages/ai/src/types.ts:427-448`).
- `calculateCost(model, usage)` runs per message from `model.cost`, which is in
  $/million tokens with optional tiers (`packages/ai/src/models.ts:1193-1215`;
  `packages/ai/src/api/openai-responses-shared.ts:560-577`).
- Our pricing code can either fill in `model.cost` or keep pricing from the
  usage token counts with `cost` set to zero.

**API keys and limits**

- **API key:** pass `options.apiKey`, or resolve one per call with `getApiKey`
  in the agent loop (`packages/ai/src/models.ts:859`;
  `packages/agent/src/agent-loop.ts:400-405`).
  - The `Agent` class does not forward a static `apiKey`
    (`packages/agent/src/agent.ts:467-505`), so use `getApiKey`.
- **Context overflow:** `isContextOverflow` is provided
  (`packages/ai/src/utils/overflow.ts:137-177`).
- **`maxTokens`:** clamped to the context window
  (`packages/ai/src/api/simple-options.ts:12-19`).

Implication: pi-ai can sit behind our existing proxy and settings. Most of
`openai-fields.ts` and `dsml-aware-chat-model.ts` becomes model and compat
configuration. `model-list.ts` and `model-capabilities.ts` stay as our layer
for building `Model` objects.

## Other facts relevant to the port

**Loop control**

- **No turn limit.** There is no `maxTurns`. The loop ends when there are no
  tool calls and no queued messages, on error or abort, when `finishTurn`
  returns `end`, or when every tool result sets `terminate`
  (`packages/agent/src/agent-loop.ts:245-320`). Turn caps are ours to implement
  in `finishTurn`.
- **Output truncated.** When the stop reason is `"length"`, the pending tool
  calls are failed without being run
  (`packages/agent/src/agent-loop.ts:264-270`).

**Events**

- `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`,
  `message_update`, `message_end`, `tool_execution_start`,
  `tool_execution_update`, `tool_execution_end`
  (`packages/agent/src/types.ts:514-529`).
- Text deltas arrive as `message_update` carrying
  `assistantMessageEvent.type === "text_delta"`
  (`packages/agent/src/agent-loop.ts:423-440`).
- `subscribe` listeners are awaited in order, so a slow UI listener applies
  backpressure to the loop (`packages/agent/src/agent.ts:609-611`).

**Steering and abort**

- `steer()` injects a message after the current tool batch. `followUp()` injects
  one when the agent would otherwise stop (`packages/agent/src/types.ts:283-306`).
- `abort()` cancels the run (`packages/agent/src/agent.ts:341-343`).

**Tools**

- `AgentTool` has a typebox `parameters` schema and
  `execute(toolCallId, params, signal, onUpdate)`. It returns
  `{ content, details, isError?, terminate? }`
  (`packages/agent/src/types.ts:424-497`).
- Arguments are validated before `execute`
  (`packages/agent/src/agent-loop.ts:725-726`).
- Our pure tool functions in `src/renderer/business/agent/tools/` need only thin
  wrappers.

**Compaction**

- Lives in `pi-coding-agent`: `compact`, `generateSummary`, `shouldCompact`,
  `findCutPoint` and `estimateTokens` are exported
  (`packages/coding-agent/src/index.ts:29-51`).
- Defaults are `reserveTokens` 16384 and `keepRecentTokens` 20000
  (`packages/coding-agent/src/core/compaction/compaction.ts:126-130`).
- `generateSummary` works on plain `AgentMessage[]`
  (`packages/coding-agent/src/core/compaction/compaction.ts:645-660`), but
  importing it pulls in the Node-only package.
- With core only, compaction is ours to write in `transformContext`
  (`packages/agent/README.md:219-220`). Our existing compaction logic can stay.

**Philosophy**

- "pi's core is minimal... If your feature does not belong in the core, it
  should be an extension" (`CONTRIBUTING.md:5-11`).
- No built-in permission system (`README.md:42`,
  `packages/coding-agent/docs/security.md:3`).
- Expect to own approvals, routing and persistence ourselves.

## Open questions for wayfinder

1. **Placement.** Use `pi-agent-core` plus `pi-ai` in the renderer (smallest
   change, own persistence and compaction), or the `pi-coding-agent` SDK in main
   with an IPC bridge (more batteries, heavier, Node-only)?
2. **Bundling spike.** Do `pi-ai` and `pi-agent-core` bundle into our CJS
   rolldown output and stream one completion inside Freelens? Specifically check
   `import.meta.url`, variable `import()` and JSON import attributes.
3. **Topology.** One agent with the full toolset, or delegate tools that run
   child agents to keep today's supervisor routing?
4. **Approval survival.** Is losing "pending approval survives restart"
   acceptable?
5. **Saved chats.** Convert existing LangGraph checkpoints to `AgentMessage[]`,
   or make a clean break?
6. **MCP SSE.** Do any users depend on legacy HTTP+SSE MCP servers, which
   `pi-mcp` does not support?
