# What pi replaces

Type: grilling
Status: resolved
Blocked by:

## Question

Which LangChain-era code, and which of our own code, goes away once pi runs
the agent in main?

## Answer

**Anything pi already does is deleted, not ported.** Resolved by leo-capvano
in PR #290: "remove all that is unnecessary with pi". The example given was
compaction, which pi already does with its own compaction and summarization.
Paths are under `src/renderer/business/` unless noted.

Deleted, because pi does the job:

- **Compaction:** `service/session-compaction.ts` and
  `session-compaction-service.ts`. pi compacts the session itself. What stays
  open is in [Session storage](11-session-storage.md).
- **Graph and checkpoints:** `agent/persistent-memory-saver.ts`,
  `checkpoint-serialization.ts`, `checkpoint-namespace.ts`,
  `state/graph-state.ts` and `nodes/teardown.ts`. pi's `SessionManager` and
  `AgentSession` replace them.
- **LangChain workarounds:**
  - `agent/runnable-context.ts`, which exists because `interrupt()` needs a
    LangChain AsyncLocalStorage
  - `provider/offline-token-chat-model.ts` and `token-estimate.ts`, which
    work around LangChain's tiktoken download
  - `service/stream-merge.ts`, which merges LangChain chunks. pi sends
    message boundaries as events.
- **Model layer:**
  - `provider/model-provider.ts` and `openai-fields.ts`: pi's `ModelRuntime`
    builds the clients.
  - `model-capabilities.ts`: pi's catalog carries the reasoning flag and
    limits, and `thinkingLevel` replaces our reasoning-effort mapping.
- **Pricing:** `provider/model-pricing.ts` and `model-pricing-provider.ts`
  (LiteLLM). pi works out the cost of each message from its model catalog.
  The token and cost UI stays, fed from pi's `usage` instead.
- **The local AI proxy:** `src/main/ai-proxy-server.ts`. Keys now live in main
  next to pi. Custom base URLs become pi custom providers, so the
  `x-upstream-base-url` routing goes too.
- **Multi-agent and MCP:** `agent/supervisor-*.ts`, `freelens-agent-system.ts`,
  the four sub-agents and `mcp-agent.ts`, as already ruled on the map.
- **Packages:** `@langchain/*`, and `zod` once the tools move.

Tools are rewritten, not wrapped:

- The tool schemas move from zod to typebox, using the `Type` that pi-ai
  re-exports.
- The pure helpers (`field-filter`, `project-resource`, `resource-handlers`)
  and their tests carry over.
- Where each tool runs is [Where cluster tools execute](08-where-cluster-tools-execute.md).

Deleted with a known risk:

- `agent/leaked-tool-calls.ts` and `provider/dsml-aware-chat-model.ts`.
  - These recover tool calls from DeepSeek "DSML" text that leaks from
    OpenAI-compatible endpoints that don't parse tool calls server-side.
  - pi does not recover them, so affected endpoints go back to raw markup
    in the chat and no tool runs.
  - If users report it, the fix belongs in a pi custom provider or
    extension, not in the core.

Moved onto pi rather than deleted:

- **AI Explain** (`service/ai-analysis-service.tsx`) runs in main as a one-shot
  pi call with no tools.
- It uses the same IPC bridge as the chat, so its message shape is part of
  [IPC event protocol](09-ipc-event-protocol.md).
