# Spec: pi agent core

Status: ready-for-agent

Source: the wayfinder map [`../pi-agent-core/map.md`](../pi-agent-core/map.md)
and its fifteen resolved tickets. Every decision below links back to the
ticket that settled it. Primary source for pi facts:
`docs/PI_AGENT_SDK_RESEARCH.md` (pi 1.0.0, npm scope `@earendil-works/pi-*`).

## Problem Statement

The Freelens AI chat runs a LangChain/LangGraph supervisor with four
sub-agents in each cluster window. Keeping it working means maintaining our own
harness: checkpoint serialization, compaction, token estimation, LiteLLM
pricing, a local proxy that injects the OpenAI key, stream merging and
workarounds for leaked tool calls. The user can only use OpenAI or an
OpenAI-compatible endpoint, there is no way to sign in with a subscription,
the agent can only be stopped by a hidden step limit, and every new capability
(MCP, sub-agents, more providers) has to be written by hand.

## Solution

The chat is driven by one pi agent (`pi-coding-agent` SDK) running in the
extension's main process. It talks to the cluster through the existing tool
code, which runs in the cluster window and is called from main over IPC.
Changes to the cluster still wait for the user's approval. Answers stream into
the existing chat UI, chats are saved as pi session files, and the user can
connect any provider pi ships, with an API key or a subscription login, plus
custom OpenAI-compatible endpoints. pi's own compaction, retries, cost
calculation and model catalog replace our custom code, and no LangChain or
LangGraph is left. The user sees the same chat, with a Stop button, a model
picker fed by the providers they connected, and a new provider settings page.

## User Stories

Chatting

1. As a cluster operator, I want to ask the assistant about the cluster open in
   this window, so that I get answers grounded in that cluster.
2. As a cluster operator, I want the answer to stream in as it is generated, so
   that I can start reading before it ends.
3. As a cluster operator, I want to see each tool call and its result in the
   transcript, so that I know what the assistant looked at or changed.
4. As a cluster operator, I want the model's reasoning to show when the model
   provides it, so that I can follow how it reached an answer.
5. As a cluster operator, I want a Stop button while a run is going, so that I
   can end a run that loops or goes the wrong way.
6. As a cluster operator, I want the input disabled while a run is going, so
   that I do not send a message that is silently dropped.
7. As a cluster operator, I want a provider error (bad key, rate limit, network)
   shown in the chat, so that I know why no answer came.
8. As a cluster operator, I want pi to retry temporary provider errors on its
   own, so that a brief outage does not end my run.
9. As a cluster operator, I want the chat to come back as it was when I close
   and reopen the cluster window, even mid-run, so that I do not lose a
   partial answer or a pending approval.
10. As a cluster operator, I want my chat to still be there after restarting
    Freelens, so that I can continue the conversation.
11. As a cluster operator with several cluster windows open, I want each window
    to show only its own cluster's chat, so that conversations never mix.
12. As a cluster operator, I want long conversations compacted automatically,
    with a line in the transcript when it happens, so that the chat keeps
    working past the model's context limit.
13. As a cluster operator, I want to see tokens used, cost and how full the
    context is, so that I can keep an eye on spending.
14. As a cluster operator, I want the assistant to answer general Kubernetes
    questions without calling tools, so that simple questions are fast.

Cluster tools

15. As a cluster operator, I want the assistant to list namespaces, read the
    cluster version and read warning events, so that it can orient itself.
16. As a cluster operator, I want the assistant to list and read any resource
    kind the cluster serves, including CRDs, so that it is not limited to
    built-in kinds.
17. As a cluster operator, I want the assistant to read pod logs with a filter
    and a tail limit, so that it can diagnose failing pods.
18. As a cluster operator, I want the assistant to create, update, patch and
    delete resources, delete pods and restart workloads, so that it can fix
    what it finds.
19. As a cluster operator, I want a tool call to fail with a clear message when
    the cluster is disconnected or the window does not answer, so that the run
    does not hang.
20. As a cluster operator, I want changes to the cluster made one at a time, so
    that each change can be checked before the next.

Approvals

21. As a cluster operator, I want every change to the cluster to wait for my
    approval by default, so that nothing changes without my consent.
22. As a cluster operator, I want the approval card to show exactly the
    manifest that will be applied and the current state of the resource, so
    that I know what I am approving.
23. As a cluster operator, I want an invalid manifest rejected before I am
    asked, so that I never approve something that cannot apply.
24. As a cluster operator, I want to deny an action and have the assistant told
    so, so that it can choose another path.
25. As a cluster operator, I want a pending approval to wait for me, even if I
    close the window, so that I can answer later.
26. As a cluster operator, I want Stop and New chat to deny a pending approval,
    so that nothing is applied after I moved on.
27. As a cluster operator, I want an "Approve all in this chat" button, so that
    a long fix-up session does not ask me for every step.
28. As a cluster operator, I want a visible notice while "approve all" is on,
    with a way to turn it off, so that I always know the agent acts without
    asking.
29. As a cluster operator, I want "approve all" to reset on New chat and on
    restart, so that a new chat always starts by asking.
30. As a cluster operator, I want to choose per tool whether it needs approval,
    including pod logs, so that I can match my own risk tolerance.

Chats and storage

31. As a cluster operator, I want a New chat action, so that I can start fresh
    without the earlier context.
32. As a cluster operator, I want a "Delete all chats" action for this cluster,
    so that I can remove conversations that contain sensitive output.
33. As a cluster operator, I want chats older than a retention period deleted
    automatically (30 days by default, 0 keeps them forever), so that storage
    does not grow without bound.
34. As a cluster operator, I want the chat I am currently using never deleted
    by retention, so that cleanup never interrupts me.

Providers, models and login

35. As a user, I want to connect any provider pi supports with an API key, so
    that I am not tied to OpenAI.
36. As a user with a ChatGPT, Claude, GitHub Copilot or similar subscription, I
    want to sign in with it, so that I can use what I already pay for.
37. As a user, I want one login dialog that asks whatever the provider needs
    (a key, a choice, a browser sign-in, a device code), so that every provider
    connects the same way.
38. As a user, I want to cancel a login midway, so that I am not stuck in a
    flow I started by mistake.
39. As a user, I want to see my connected providers as cards listing their
    models, context sizes and prices, so that I know what I can use.
40. As a user, I want to log out of a provider, so that its credentials are
    removed.
41. As a user who sets API keys in environment variables, I want those
    providers shown as connected, with their source, so that I do not enter the
    key twice.
42. As a user with a self-hosted or third-party OpenAI-compatible endpoint, I
    want to add it with a short form (name, base URL, key, model ids,
    reasoning), so that I can use it in the chat.
43. As a power user, I want to see the path of the custom providers file, so
    that I can set headers, costs and compatibility flags by hand.
44. As a user, I want my API keys and tokens kept out of the cluster windows, so
    that they are not exposed to renderer code.
45. As a cluster operator, I want to pick the model in the chat from the models
    of my connected providers, grouped by provider, so that switching is quick.
46. As a cluster operator, I want the chat to remember the last model I used,
    so that I do not pick it every time.
47. As a user, I want one thinking-level setting (off to xhigh, medium by
    default), so that I control reasoning depth and cost once.
48. As an upgrading user, I want my existing OpenAI key, custom base URL and
    model choice carried over, so that the assistant keeps working after the
    update.
49. As an upgrading user, I accept that my old chats are not carried over, so
    that the upgrade stays simple.

Prompt and rules

50. As a cluster operator, I want the assistant to know which cluster it is
    talking to, so that it never confuses clusters.
51. As a cluster operator, I want my custom agent rules applied from the next
    message after I edit them, so that I do not need a new chat.
52. As a cluster operator, I want the assistant to read a resource before
    changing it, say what will change, prefer the least destructive option and
    never delete namespaces, CRDs or cluster-scoped resources unless I named
    them, so that it is safe even with "approve all" on.
53. As a cluster operator, I want the assistant unable to touch my file system
    or run shell commands, so that a cluster assistant stays a cluster
    assistant.

AI Explain

54. As a cluster operator, I want "AI Explain" on a resource or event to stream
    a Summary, Diagnosis, Impact, Recommended Actions and Reference answer into
    the chat, so that I get a quick structured diagnosis.
55. As a cluster operator, I want an explanation not to fill my chat's context,
    so that follow-up questions stay cheap.
56. As a cluster operator, I want my custom agent rules applied to AI Explain
    too, so that one preference shapes every answer.

Maintainers

57. As a maintainer, I want no LangChain, LangGraph or zod left in the
    extension, so that there is one agent stack to maintain.
58. As a maintainer, I want MCP and sub-agents to be addable later as bundled pi
    extensions, so that the core does not need another rewrite.
59. As a maintainer, I want the extension to still pack and install in Freelens
    1.8 and later, so that no user is left behind.

## Implementation Decisions

Placement and packaging

- The agent loop runs in the extension's main process on `pi-coding-agent`
  1.0.0, bundled into the CommonJS main output (no external ESM, no file-based
  pi extensions). Proven by the spike
  ([02](../pi-agent-core/issues/02-where-agent-runs.md),
  [06](../pi-agent-core/issues/06-spike-pi-in-main.md)).
- `registerBunOAuthFlows()` runs once at main startup so OAuth login modules
  load from the bundle.
- pi is configured through a `DefaultResourceLoader` with our own system
  prompt, `noTools: "builtin"`, no context files, skills, prompt templates or
  file-based extensions, and one inline extension factory that owns the
  approval hook and the per-prompt sections
  ([15](../pi-agent-core/issues/15-system-prompt-and-tool-set.md)).

Modules (new)

- **Agent host (main).** The one deep module of this spec. It owns one pi
  `AgentSession` per cluster, the `ModelRuntime`, the session folders, the
  approval gate, auto-approve state, pending tool and UI requests, the
  in-flight assistant message and the per-cluster `seq`. Its interface is
  small: `handleCommand(clusterId, command) -> RpcResponse` plus an injected
  `broadcast(envelope)` sink. It takes its collaborators by injection (pi
  session factory or model runtime, broadcast, preferences reader, clock, file
  folder) and imports nothing from the Freelens host, so it runs under vitest.
  The Freelens main extension only wires `Main.Ipc.handle` and the broadcast
  to it.
- **Shared tool definitions (common).** One definition per tool:
  `{ name, label, description, parameters (typebox), mutating,
  requiresApprovalByDefault }`. Main turns each into a pi `ToolDefinition`
  whose `execute` sends a `tool_request` and awaits the frame's
  `tool_result`; `mutating` sets `executionMode: "sequential"`. The pure
  resource helpers (`resource-handlers`, `field-filter`, `project-resource`)
  move to common so main can validate and prepare manifests.
- **Frame tool runner (renderer).** A `name -> implementation` map over
  today's tool code (`apiManager` discovery, `podsApi.getLogs`,
  `api.restart()`), which checks arguments against the shared schema, runs
  the call and replies with `tool_result` text. A disconnected cluster gives an
  error text, never a thrown error.
- **Chat client (renderer).** Replaces today's LangChain-shaped chat and agent
  services. It filters envelopes by its own `clusterId`, applies `seq` in
  order, calls `get_snapshot` on mount and reduces events into the transcript
  view state. The reduction is a pure function (envelope or snapshot in, view
  state out).
- **Provider settings (renderer page plus main commands).** Connected-provider
  cards, "Add provider" picker, the generic login dialog, custom provider
  form, thinking level, per-tool approval toggles, chat retention and custom
  agent rules ([12](../pi-agent-core/issues/12-provider-key-settings.md)).

IPC protocol ([09](../pi-agent-core/issues/09-ipc-event-protocol.md))

- Vocabulary is pi's RPC shapes: commands are a subset of `RpcCommand` plus
  ours, responses are `RpcResponse`, events are `JsonAgentSessionEvent`
  (every session event except `entry_appended`, with `partial` stripped by our
  own copy of `toJsonEvent()`).
- Main to renderer: one broadcast channel carrying

  ```ts
  { clusterId, sessionId, seq, kind, payload }
  // kind: "event" | "stats" | "tool_request" | "ui_request"
  ```

  `seq` increases per cluster. Frames drop envelopes for other clusters.
  Provider-wide traffic (login prompts) is not cluster-bound; it carries no
  `clusterId` filter and is consumed by the settings page.
- Renderer to main: one `Main.Ipc.handle` channel taking
  `(clusterId, command)` and answering through the `invoke` promise.
  Per-cluster commands: `prompt`, `abort`, `new_session`,
  `get_session_stats`, `get_snapshot`, `delete_sessions`, `tool_result`,
  `ui_response`, `set_auto_approve`, `explain`. Global commands
  ([12](../pi-agent-core/issues/12-provider-key-settings.md)): list providers
  with status, list available models, start and cancel a login, log out, add
  and remove a custom provider, set the thinking level.
- Failures before a run starts (no model, no credentials) return
  `success: false`; errors during a run arrive as events.
- `get_snapshot` answers
  `{ messages, streamingMessage?, isStreaming, pendingToolRequests,
  pendingUiRequest?, autoApprove, seq }`; the frame then applies only
  envelopes with a higher `seq`.
- A `stats` envelope with pi's `SessionStats` (tokens, cost, context usage)
  goes out after each assistant `message_end` and at `agent_settled`. The
  renderer computes nothing.
- The session listener never awaits the renderer. The only awaited round
  trips are tool requests (about 30 s timeout, longer for logs) and approvals
  (no timeout).
- Input is disabled while a run is going; Stop (`abort`) is the only action.

Tools ([08](../pi-agent-core/issues/08-where-cluster-tools-execute.md),
[15](../pi-agent-core/issues/15-system-prompt-and-tool-set.md))

- All twelve of today's tools, no merges, no new ones: `getNamespaces`,
  `getClusterVersion`, `getWarningEventsByNamespace` (renamed from
  `getEventsForNamespace`), `listKubernetesResources`,
  `getKubernetesResource`, `getPodLogs`, `createKubernetesResource`,
  `updateKubernetesResource`, `patchKubernetesResource`,
  `deleteKubernetesResource`, `deletePod`, `restartKubernetesResource`.
- Mutating: the last six. Approval by default: the six mutating tools and
  `getPodLogs`.
- A chat is bound to the cluster of the frame that started it; no
  cross-cluster tools. Tools need an open cluster frame (no headless runs).
- Tool guidance lives in the description or the system prompt, because pi
  drops `promptGuidelines` with a custom prompt.

Approvals ([10](../pi-agent-core/issues/10-approvals-over-ipc.md))

- The gate runs in main in the inline extension's `tool_call` hook, before the
  `tool_request` is sent. Main validates and prepares the manifest, rejects an
  invalid one without asking, writes the prepared manifest back into the tool
  input and builds the action YAML.
- The request is pi's `confirm` plus one field:

  ```ts
  { id, title /* "UPDATE DEPLOYMENT" */, message /* action YAML */,
    approval: { tool, kind, apiVersion, name, namespace } }
  // answer: { id, confirmed, approveAll? }
  ```

- The frame captures the backup YAML of the current resource when it renders
  the card, best effort, recomputed on remount.
- Denial blocks with the reason "The user denied the action". No timeout;
  Stop and New chat resolve a pending approval as denied.
- Which tools ask is a per-tool override map in the preferences, keyed by tool
  name, defaulting to `requiresApprovalByDefault`. `podLogsRequireApproval`
  becomes the `getPodLogs` override.
- "Approve all in this chat" is in-memory per session in main, cleared by New
  chat, Delete all chats and restart; validation still runs. It replaces the
  old `bypassApprovals` flag.

Sessions ([11](../pi-agent-core/issues/11-session-storage.md),
[13](../pi-agent-core/issues/13-turn-limit.md),
[03](../pi-agent-core/issues/03-existing-saved-chats.md))

- One JSONL file per chat in `<extension folder>/sessions/<clusterId>/`,
  through `SessionManager`; the session `cwd` is that folder. One active chat
  per cluster; New chat starts a new file.
- pi's default compaction, no settings, no manual button; compaction shows as
  a line in the transcript.
- No turn cap. pi's retries and compaction apply; Stop is the safeguard.
- Retention: on main activation and on New chat, delete session files not
  modified for longer than the retention preference (default 30 days, 0 keeps
  forever), across all cluster folders, never a cluster's active chat.
- `ChatSessionStore` and `AgentStateStore` are deleted. Old store files and
  LangGraph checkpoints are left on disk and ignored; no conversion.

Prompt ([15](../pi-agent-core/issues/15-system-prompt-and-tool-set.md))

- One system prompt constant in main, merged from today's analyzer, operator
  and general-purpose prompts, with the identity, tool rules, `<log_reading>`,
  `<subresources>`, error handling, style and the five safety rules settled in
  the ticket.
- Per-prompt sections set in `before_agent_start`: `cluster` (the cluster
  name as Freelens shows it) and `user_rules` (the custom agent rules
  preference, omitted when empty).

Providers ([05](../pi-agent-core/issues/05-providers-first-version.md),
[12](../pi-agent-core/issues/12-provider-key-settings.md))

- `ModelRuntime.create({ authPath, modelsPath })` with
  `<extension folder>/pi/auth.json` and `<extension folder>/pi/models.json`.
  Credentials never reach the renderer.
- API keys and OAuth both go through `ModelRuntime.login()`; login prompts
  (`text`, `secret`, `select`, `manual_code`, `auth_url`, `device_code`,
  `info`, `progress`) go out as `ui_request` and come back as `ui_response`.
- The chat picker lists `getAvailable()` grouped by provider and remembers the
  last model used. The settings page has no default-model control.
- Thinking level is one global preference, default `medium`.
- One-time import on first start: a non-empty `openAIKey` with the default
  base URL becomes an `openai` key in `auth.json`; with a custom base URL it
  becomes a custom OpenAI-compatible provider in `models.json` carrying the
  key and the old model ids; `selectedModel` seeds the last used model. A
  marker makes the import run once. The old fields are cleared only when the
  LangChain path is removed, because AI Explain still reads them until it moves
  to pi.

Removed ([14](../pi-agent-core/issues/14-what-pi-replaces.md))

- The supervisor and the four sub-agents, `mcp-agent`, LangGraph checkpoints
  and graph state, compaction, `runnable-context`, the offline token model,
  token estimation, stream merging, the model provider, OpenAI fields, model
  capabilities, the editable model list, LiteLLM pricing, the leaked-tool-call
  and DSML recovery, the local AI proxy, and the `@langchain/*` and `zod`
  packages.
- Preference fields: `openAIKey`, `openAIBaseUrl`, `openAIReasoningEffort`,
  `disableThinking`, `aiProxyPort`, `aiProxyToken`, `models`,
  `podLogsRequireApproval`, `mcpEnabled`, `mcpConfiguration` and the
  in-memory `bypassApprovals`.
- The "AI Model & Provider System" section of `AGENTS.md` is rewritten to
  describe pi.

## Testing Decisions

- A good test drives a module through its public interface and asserts what a
  user or the other process would observe: envelopes broadcast, responses
  returned, files on disk, view state rendered. It never asserts on pi's
  internals or on private fields.
- **Seam 1, the agent host (main).** The highest seam and the main one. Tests
  create the host with pi-ai's faux provider (proven in the spike, no key,
  runs under Node), a recording `broadcast`, a temporary folder and a fake
  preferences reader, then send commands and assert on envelopes and
  responses. This covers streaming, `seq`, snapshots, tool requests and
  timeouts, the approval gate, approve all, abort, New chat, delete,
  retention, per-prompt sections and the one-time import.
- **Seam 2, the chat client reduction (renderer).** A pure function from
  snapshot plus envelopes to transcript view state. Tests feed recorded
  envelope sequences (including gaps, other clusters' envelopes and remounts)
  and assert the view state.
- **Seam 3, the frame tool runner (renderer).** Tests call the runner with a
  tool name and arguments against fake cluster APIs and assert the reply text,
  including schema rejection and disconnected clusters. Prior art: today's
  `cluster-version`, `pod-logs` and `resource-handlers` tests.
- The pure helpers keep their tests as they move to common: `field-filter`,
  `project-resource`, `resource-handlers`, `redact`, `agent-rules`,
  `managed-fields`, `extension-preferences`, `chat-readiness` if it survives.
- Tests tied only to deleted code are deleted with it: checkpoints,
  `runnable-context`, `supervisor-routing`, `leaked-tool-calls`, DSML, the
  offline token model, token estimation, model capabilities, model list,
  OpenAI fields, LiteLLM pricing, compaction, stream merge, token usage and
  the AI proxy.
- The UI pieces (settings cards, login dialog, approval card) are checked by
  hand in a real Freelens through `pnpm pack:dev`. Each ticket that changes
  them says what to check.
- Every ticket ends with `pnpm lint:fix`, `pnpm type:check`,
  `pnpm test:unit` and `pnpm build` green.

## Out of Scope

- Multi-agent and supervisor routing; may return as a bundled pi sub-agents
  extension.
- MCP; may return as a bundled pi extension (for example
  `createMcpExtension()`).
- Loading file-based pi extensions from npm or `~/.pi`.
- Converting existing LangGraph chats.
- Recovering DeepSeek DSML tool calls leaked by OpenAI-compatible endpoints.
- A chat history picker, queued follow-ups and steering while a run is going,
  "deny with a note", a per-chat thinking level, a raw `models.json` editor,
  compaction settings and a "compact now" button.
- Tool use without an open cluster frame, and tools that work across clusters.
- Surviving a pending approval across an app restart.

## Further Notes

- Each provider's terms decide whether its subscription login may be used
  inside Freelens; pi does not check this.
- On macOS a Freelens started from the Dock does not see the shell's
  environment variables, so env-var keys mostly help Linux users and people
  who start Freelens from a terminal.
- The dev build (`preserveModules`) is about 2000 files and prints harmless
  typebox circular dependency warnings; the production build is about 13 MB
  unpacked before LangChain is removed.
- Build tickets: [`issues/`](issues/). The first one is the end-to-end tracer
  and includes the human check the spike left open: `pnpm pack:dev` with pi in
  `src/main`, installed in a real Freelens.
