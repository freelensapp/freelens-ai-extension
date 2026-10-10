# 03: The merged system prompt with cluster and user rules sections

**What to build:** the agent speaks as Freelens AI for the cluster open in this
window, follows the safety rules, and applies the user's custom agent rules
from the next message after an edit. The placeholder prompt from 01 is
replaced by the merged prompt settled in
[ticket 15 of the map](../../pi-agent-core/issues/15-system-prompt-and-tool-set.md).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] One system prompt constant in main, merged from the analyzer, operator
      and general-purpose prompts: identity, tool rules, `<log_reading>`,
      `<subresources>`, error handling, concise Markdown, and the five safety
      rules. No "coding task" wording, no emoji.
- [ ] The inline extension's `before_agent_start` sets a `cluster` section
      with the cluster name as Freelens shows it on every prompt.
- [ ] It sets a `user_rules` section from the custom agent rules preference on
      every prompt, and sets no section when the preference is empty.
- [ ] Agent host tests: the faux provider receives the cluster name and the
      current rules, and an edit to the rules between two prompts reaches the
      second prompt.
- [ ] The supervisor, conclusions and per-agent prompt templates are no longer
      used by the chat (deleted in ticket 14).
