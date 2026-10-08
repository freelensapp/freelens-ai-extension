# System prompt and tool set of the single agent

Type: grilling
Status: open
Blocked by:

## Question

What does the one pi agent get as its system prompt and tools?

Today the prompts are split across the supervisor and four sub-agents
(`src/renderer/business/agent/analyzer-agent.ts`, `conclusions-agent.ts`,
`general-purpose-agent.ts`, `kubernetes-operator-agent.ts`,
`supervisor-agent.ts`), with shared templates in
`src/renderer/business/provider/prompt-template-provider.ts`. The supervisor
and multi-agent routing are out of scope, so their prompts are merged or
dropped.

Open:

- Which parts of today's prompts carry over (cluster context, safety rules for
  mutating actions, answer style) and which only existed for routing.
- How the prompt is set in pi: `pi-coding-agent` ships its own coding-agent
  system prompt and built-in tools (file read/write, bash). Do we replace the
  prompt entirely and disable the built-in tools, since a cluster assistant
  should not touch the user's file system or shell?
- The tool set. Today's tools in `src/renderer/business/agent/tools/tools.ts`:
  `getNamespaces`, `getClusterVersion`, `getEventsForNamespace`,
  `listKubernetesResources`, `getKubernetesResource`,
  `createKubernetesResource`, `updateKubernetesResource`,
  `patchKubernetesResource`, `getPodLogs`, `deleteKubernetesResource`,
  `deletePod`, `restartKubernetesResource`. Keep all, merge any, add any?
- Where tool schemas live. Per [08](08-where-cluster-tools-execute.md) the
  tools execute in the renderer frame, but pi needs the typebox schemas in
  main ([14](14-what-pi-replaces.md)). The schemas probably belong in
  `src/common/` so both sides share one definition.

Settled inputs:

- [09](09-ipc-event-protocol.md): each tool's `execute` in main sends a
  `tool_request` envelope and awaits the frame's `tool_result` command.
- [10](10-approvals-over-ipc.md): the approval gate runs in main in the
  `tool_call` hook. Each tool definition in `src/common/` carries a default
  approval flag (today's gated tools: the six write tools and `getPodLogs`),
  which the user can override per tool in settings. A chat can switch to
  "approve all", so the prompt's safety rules should not assume the user sees
  every mutating call.
