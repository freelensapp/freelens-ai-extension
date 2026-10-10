# 08: Per-tool "Requires approval" settings

**What to build:** the settings page lists every tool with a "Requires
approval" toggle, defaulting to each tool's `requiresApprovalByDefault`. The
user's choices are stored as overrides keyed by tool name in the preferences,
so a new tool gets its default. The existing `podLogsRequireApproval`
preference becomes the `getPodLogs` override and stops being used.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] The tool list on the settings page comes from the shared tool
      definitions, not a hand-written list.
- [ ] Overrides are stored in the preferences by tool name; only changed tools
      are stored.
- [ ] The gate in main reads the override, falling back to the default, at the
      time of each call, so a change applies to the next call.
- [ ] A saved `podLogsRequireApproval: false` becomes a `getPodLogs: false`
      override once, and the old field is no longer read.
- [ ] Agent host tests cover a default-gated tool turned off, a read tool
      turned on, and the pod logs import.
- [ ] HITL: turn off approval for `restartKubernetesResource` and see a
      restart run without a card.
