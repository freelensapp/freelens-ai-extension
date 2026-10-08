# System prompt and tool set of the single agent

Type: grilling
Status: claimed
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

## Facts gathered

- Today's prompts (`src/renderer/business/provider/prompt-template-provider.ts`):
  - `AGENT_ANALYZER_PROMPT_TEMPLATE` (read tools): identity, scope, a
    `<log_reading>` block on `getPodLogs`'s `filter`, a `<tool_calling>` block
    (follow the schema, never call missing tools, never name tools to the
    user, explain before each call, no shell or kubectl), parameter rules.
  - `KUBERNETES_OPERATOR_PROMPT_TEMPLATE` (write tools): the same
    `<tool_calling>` block, "do not loop on errors, surface them", a
    `<subresources>` block (`resize`, `scale`), and "don't call a tool more
    than one time". The operator graph binds `parallel_tool_calls: false` and
    ends with a "finish" node that tells the user the agent handles one task
    at a time (`kubernetes-operator-agent.ts:37-58`).
  - `GENERAL_PURPOSE_AGENT_PROMPT_TEMPLATE`: answers general Kubernetes and
    technical questions without tools, Markdown, no shell.
  - `SUPERVISOR_PROMPT_TEMPLATE` and `CONCLUSIONS_AGENT_PROMPT_TEMPLATE`:
    routing and a closing summary. Both exist only for the supervisor.
  - `ANALYSIS_PROMPT_TEMPLATE`: AI Explain, a fixed Summary / Diagnosis /
    Impact / Recommended Actions / Reference layout with emoji headings.
  - Several blocks say "the coding task", copied from a coding-agent prompt.
- Every agent prompt gets the user's "custom agent rules" preference appended
  (`agent-rules-provider.ts`, `appendCustomAgentRules`).
- No prompt carries cluster context today (no cluster name, version or
  namespace).
- Tool names: the warning-events tool is exported as
  `getWarningEventsByNamespace` but registered as `getEventsForNamespace`
  (`tools/tools.ts:89-125`). `toolFunctionDescriptions` repeats every tool
  description by hand for the supervisor (`tools.ts:317`).
- pi 1.0.0 system prompt (`pi-coding-agent/dist/core/system-prompt.js`):
  - A custom prompt (`DefaultResourceLoader({ systemPrompt })`) replaces the
    whole coding preamble, the tool list, the rules and the pi docs block
    (`:76`). The spike already used this with `noTools: "builtin"`, which
    removes `read`, `bash`, `edit` and `write`.
  - With a custom prompt, tools' `promptGuidelines` and `promptSnippet` are
    **not** rendered (they only feed the default rules, `:30`). Guidance for a
    tool has to sit in its description or in our prompt.
  - pi still appends, as XML sections: `addendum` (`appendSystemPrompt`,
    `:96`), `project_context` (context files, off with `noContextFiles`),
    `skills` (only with a `read` or `bash` tool, `:99`), and **always** `cwd`
    (`:105`). An extension's `before_agent_start` handler can add or change
    named `sections` per prompt, and pi sends only the changed sections to
    the model.
  - Each tool can set `executionMode: "sequential"` to stop it running in
    parallel with other calls (`extensions/types.d.ts:483-490`).

## Grilling round 1

Q1. How is the prompt set in pi?
Recommendation: our own prompt through `DefaultResourceLoader({ systemPrompt
})`, with `noTools: "builtin"`, `noContextFiles`, `noSkills`,
`noPromptTemplates` and no file-based extensions, as in the spike. The
session `cwd` is the cluster's session folder, so the always-on `cwd` section
shows only that path. The prompt is a constant in `src/main/`.

Q2. What carries over into the one prompt?
Recommendation: one prompt merged from analyzer, operator and general
purpose:
- identity: Freelens AI, a Kubernetes assistant for the cluster open in this
  window, that also answers general Kubernetes and technical questions
  without tools;
- the tool rules: follow the schema, never invent tools, no shell / kubectl /
  helm, ask for missing required values, use quoted values exactly;
- `<log_reading>` and `<subresources>` as they are today;
- "if a tool errors, report it and ask; do not retry the same call in a
  loop";
- Markdown answers, concise.
Dropped: the supervisor and conclusions prompts, the operator's "finish" node
and "one task at a time" message, "don't call a tool more than one time"
(it only made sense with the operator graph), "explain before each call"
(the chat already shows each tool call), "never name tools" (same reason),
and the "coding task" wording.

Q3. Safety rules, given "approve all"
Recommendation: rules that hold whether or not the user is asked:
- read before you write: look up the current resource before changing it;
- one mutating call at a time, and check the result before the next;
- before a mutating call, say in one line what will change;
- prefer the least destructive option (patch over update, evict over force
  delete, normal delete before `force_finalize`), and use force modes only
  after the normal one failed or the user asked;
- never delete namespaces, CRDs or cluster-scoped resources unless the user
  named them explicitly.
"One at a time" is also enforced in code: every write tool sets
`executionMode: "sequential"`. Read tools stay parallel.

Q4. Cluster context in the prompt
Recommendation: a small `cluster` section set in `before_agent_start` on each
prompt: the cluster name as Freelens shows it. Nothing else; the model calls
`getClusterVersion` or `getNamespaces` when it needs more. This also tells
the model which cluster a chat is bound to (08).

Q5. The user's custom agent rules
Recommendation: keep the preference. Main reads it on each prompt and puts it
in a `user_rules` section through `before_agent_start`, so an edit applies
from the next message of the open chat. Empty means no section.

Q6. The tool set
Recommendation: keep all twelve, no merges and no new tools in v1. Fix the
name mismatch by registering the warning-events tool as
`getWarningEventsByNamespace` (approval settings from 10 are new, so no
stored setting depends on the old name). `toolFunctionDescriptions` goes; pi
sends the tool definitions itself.

Q7. Where tool definitions live
Recommendation: `src/common/agent-tools/`, one file per tool or group, each
exporting `{ name, label, description, parameters (typebox), mutating,
requiresApprovalByDefault }`. Main wraps each one in a pi `ToolDefinition`
whose `execute` sends a `tool_request` (09) and turns the frame's text reply
into pi's tool result. The frame keeps a `name -> implementation` map over
today's `kubernetes-resource.ts` / `pod-logs.ts` / `cluster-version.ts`, and
validates the arguments against the same schema before it runs. The
`mutating` flag drives `executionMode: "sequential"` (Q3) and the
approval-settings list (10).

Q8. The AI Explain prompt
Recommendation: carry `ANALYSIS_PROMPT_TEMPLATE` over to main as the explain
call's system prompt with the same five sections, but plain headings without
emoji (the repo rule bans emoji in source). Today Explain does not get the
custom agent rules; add them there too, so one preference shapes every
answer.
