# 14: Remove LangChain, LangGraph, the AI proxy and the old preferences

**What to build:** the contract step. Once nothing uses the old stack, delete
it, so the extension has one agent stack and a smaller package.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13

**Status:** resolved (HITL check pending)

- [x] Deleted: the supervisor, the four sub-agents, `mcp-agent`, checkpoints
      and graph state, compaction, `runnable-context`, the offline token
      model, token estimation, stream merging, the model provider, OpenAI
      fields, model capabilities, the editable model list, LiteLLM pricing,
      leaked-tool-call and DSML recovery, the old chat and agent services,
      `toolFunctionDescriptions`, and the local AI proxy, with their tests.
- [x] Deleted: `ChatSessionStore` and `AgentStateStore`; their files on disk
      are left alone.
- [x] Deleted preference fields: `openAIKey`, `openAIBaseUrl`,
      `openAIReasoningEffort`, `disableThinking`, `aiProxyPort`,
      `aiProxyToken`, `models`, `podLogsRequireApproval`, `mcpEnabled`,
      `mcpConfiguration` and `bypassApprovals`, with their settings UI.
      The one-time imports from tickets 01, 08 and 11 still read them from an
      old store file, then clear them from it.
- [x] `@langchain/*` and `zod` are gone from `package.json` and the lockfile;
      pi packages stay bundled.
- [x] `AGENTS.md` "AI Model & Provider System" describes pi (agent host,
      shared tool definitions, credentials in `auth.json` / `models.json`,
      the IPC protocol), and `pnpm trunk:fix` has run on the markdown.
- [x] `pnpm lint:check`, `pnpm type:check`, `pnpm test:unit`, `pnpm build`
      and `pnpm build:production` pass; the packed size is recorded in the
      ticket.
- [ ] HITL: `pnpm pack:dev`, upgrade an install that has an old OpenAI key and
      old chats, and see the key carried over, the old chats gone, and a full
      read, approve and change run work.

## Answer

Built in `c40ca77` (code) and `3f31474` (docs).

- **Old fields are written back as `null`, not dropped.** Freelens saves an
  extension store key by key (`config.set` for each key of `toJSON()`), so a
  field only left out of `toJSON()` stays in the file, the plain-text
  `openAIKey` included. `PreferencesStore` keeps the old fields it finds in
  an observable `legacy` object and saves them back unchanged; main reads
  them for the two imports and then calls `clearLegacy()`, which sets each one
  to `null`. A failed import keeps them for the next start. The helpers are in
  `src/common/store/legacy-preferences.ts`, with tests.
- **An old custom Base URL that could not be imported** loses its key too: the
  settings page has no field for it any more, and the endpoint can be added
  again with "Add custom endpoint".
- **The chat transcript lives in the cluster frame's memory.** It used to be
  mirrored into `ChatSessionStore`. The agent client's chat is now the only
  copy (`editAgentTranscript` for the page's own messages), and main's snapshot
  rebuilds it from the pi session. A refused prompt or an AI Explain answer in
  a cluster that never chatted is no longer kept across a Freelens restart.
- **Manifest schemas** (`resource-handlers.ts`) moved from zod to typebox and
  are checked with `Value.Errors`, as the tool runner does.
- **Tool list** next to the input now shows `AGENT_TOOLS` with the first
  sentence of each description.
- **Docs:** `AGENTS.md` describes the pi agent; the README describes providers,
  custom endpoints, Ollama and the upgrade; `docs/BASE_AGENT.md` and
  `docs/MCP_AGENT.md` were removed.
- **Checks:** `pnpm type:check`, `pnpm test:unit`, `pnpm build` and
  `pnpm build:production` pass, and biome is clean on `src`. `pnpm lint:check`
  itself fails on the runner's untracked `tmp/freelens` checkout, which has its
  own biome config. Trunk is clean on `AGENTS.md` and `README.md`.
- **Size:** the production build packs to 7.6 MB (`pnpm pack`, source maps
  included; 37 MB unpacked). The published extension with LangChain was 11 MB.
