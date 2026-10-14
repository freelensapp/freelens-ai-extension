# 03: The merged system prompt with cluster and user rules sections

**What to build:** the agent speaks as Freelens AI for the cluster open in this
window, follows the safety rules, and applies the user's custom agent rules
from the next message after an edit. The placeholder prompt from 01 is
replaced by the merged prompt settled in
[ticket 15 of the map](../../pi-agent-core/issues/15-system-prompt-and-tool-set.md).

**Blocked by:** 01

**Status:** resolved (HITL check pending)

- [x] One system prompt constant in main, merged from the analyzer, operator
      and general-purpose prompts: identity, tool rules, `<log_reading>`,
      `<subresources>`, error handling, concise Markdown, and the five safety
      rules. No "coding task" wording, no emoji.
- [x] The inline extension's `before_agent_start` sets a `cluster` section
      with the cluster name as Freelens shows it on every prompt.
- [x] It sets a `user_rules` section from the custom agent rules preference on
      every prompt, and sets no section when the preference is empty.
- [x] Agent host tests: the faux provider receives the cluster name and the
      current rules, and an edit to the rules between two prompts reaches the
      second prompt.
- [x] The supervisor, conclusions and per-agent prompt templates are no longer
      used by the chat (deleted in ticket 14).

## Answer

- **Prompt** (`src/main/agent/system-prompt.ts`): identity and scope, a
  `<tool_calling>` block (schema, only provided tools, no shell / kubectl /
  helm, ask for missing required values, use quoted values exactly),
  `<log_reading>`, `<subresources>`, a `<safety>` block with the five rules
  (stated to hold whether or not the user is asked), "report errors, do not
  loop", and concise Markdown. Pinned by `system-prompt.test.ts`, which also
  rejects non-ASCII characters so no emoji slips in.
- **`<log_reading>` is not byte-for-byte the old text.** The analyzer's
  multi-container and CrashLoopBackOff hints moved into it, and the
  `"(?i)"-style casing variants` hint is dropped: the filter is a JavaScript
  `RegExp`, where `(?i)` is invalid.
- **Sections** (`agent-host.ts`): a `before_agent_start` handler sets
  `sections.cluster` from the new `getClusterName(clusterId)` option and
  `sections.user_rules` from `getUserRules()`, both trimmed and skipped when
  empty. pi gives each prompt a fresh copy of the sections and sends the model
  a patch with only the changes, so an unset section is removed (null patch).
  The sections also survive tool-call turns, compaction and a reopened
  session file (checked in pi 1.0.0's source).
- **Cluster name** (`src/main/index.ts`): `Main.Catalog.getClusterById(id).name`,
  the catalog entity's `metadata.name`, which is what Freelens shows. That API
  exists from Freelens 1.10; older hosts send no `cluster` section.
- **AI Explain** is unchanged: its own session has no extensions, and it still
  gets the rules through `withUserRules`.
- **Old prompts:** typed messages only reach pi. The LangChain analyzer,
  operator and general-purpose prompts are reachable only through the legacy
  `resumeInterrupt` path for old LangGraph interrupts, which ticket 14 deletes
  together with `prompt-template-provider.ts`.
- **Tests:** 5 agent host tests (cluster name and rules reach the model, a
  rules edit reaches the next prompt and clearing them drops the section, the
  name is read on every prompt, no sections when both are empty, the merged
  prompt is the default) and 4 prompt tests.

HITL check: install the `.tgz` from `pnpm pack:dev`, ask "which cluster am I
in?" (the answer should name the cluster as the catalog shows it), then set
"Answer in Italian" as a custom agent rule and send another message in the same
chat (the answer should switch to Italian).
