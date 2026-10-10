# 14: Remove LangChain, LangGraph, the AI proxy and the old preferences

**What to build:** the contract step. Once nothing uses the old stack, delete
it, so the extension has one agent stack and a smaller package.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13

**Status:** ready-for-agent

- [ ] Deleted: the supervisor, the four sub-agents, `mcp-agent`, checkpoints
      and graph state, compaction, `runnable-context`, the offline token
      model, token estimation, stream merging, the model provider, OpenAI
      fields, model capabilities, the editable model list, LiteLLM pricing,
      leaked-tool-call and DSML recovery, the old chat and agent services,
      `toolFunctionDescriptions`, and the local AI proxy, with their tests.
- [ ] Deleted: `ChatSessionStore` and `AgentStateStore`; their files on disk
      are left alone.
- [ ] Deleted preference fields: `openAIKey`, `openAIBaseUrl`,
      `openAIReasoningEffort`, `disableThinking`, `aiProxyPort`,
      `aiProxyToken`, `models`, `podLogsRequireApproval`, `mcpEnabled`,
      `mcpConfiguration` and `bypassApprovals`, with their settings UI.
      The one-time imports from tickets 01, 08 and 11 still read them from an
      old store file, then clear them from it.
- [ ] `@langchain/*` and `zod` are gone from `package.json` and the lockfile;
      pi packages stay bundled.
- [ ] `AGENTS.md` "AI Model & Provider System" describes pi (agent host,
      shared tool definitions, credentials in `auth.json` / `models.json`,
      the IPC protocol), and `pnpm trunk:fix` has run on the markdown.
- [ ] `pnpm lint:check`, `pnpm type:check`, `pnpm test:unit`, `pnpm build`
      and `pnpm build:production` pass; the packed size is recorded in the
      ticket.
- [ ] HITL: `pnpm pack:dev`, upgrade an install that has an old OpenAI key and
      old chats, and see the key carried over, the old chats gone, and a full
      read, approve and change run work.
