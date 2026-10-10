# 08: Per-tool "Requires approval" settings

**What to build:** the settings page lists every tool with a "Requires
approval" toggle, defaulting to each tool's `requiresApprovalByDefault`. The
user's choices are stored as overrides keyed by tool name in the preferences,
so a new tool gets its default. The existing `podLogsRequireApproval`
preference becomes the `getPodLogs` override and stops being used.

**Blocked by:** 05

**Status:** resolved (HITL check pending)

- [x] The tool list on the settings page comes from the shared tool
      definitions, not a hand-written list.
- [x] Overrides are stored in the preferences by tool name; only changed tools
      are stored.
- [x] The gate in main reads the override, falling back to the default, at the
      time of each call, so a change applies to the next call.
- [x] A saved `podLogsRequireApproval: false` becomes a `getPodLogs: false`
      override once, and the old field is no longer read.
- [x] Agent host tests cover a default-gated tool turned off, a read tool
      turned on, and the pod logs import.
- [ ] HITL: turn off approval for `restartKubernetesResource` and see a
      restart run without a card.

## Answer

- `src/common/agent-tools/approval-settings.ts` holds the pure helpers:
  `requiresApproval(tool, overrides)`, `withApprovalOverride` (drops an entry
  equal to the default) and `loadApprovalOverrides` (the pod logs import).
- The preference is `toolApprovalOverrides`. It is deliberately not in the
  store's `defaults`: a missing field means the old setting has not been
  imported yet. The host only writes a preference when one changes, so until
  then the import is redone, with the same result, at each launch; the old
  field stays in the file but is ignored once `toolApprovalOverrides` exists.
- `AgentHostOptions.requiresApproval` became `getApprovalOverrides`, so the
  lookup and its fallback run inside the host and are covered by its tests.
- The settings page has a "Tool approvals" section with one switch per tool
  in `AGENT_TOOLS`; the old pod logs switch is gone, the tail lines field
  stays. The old LangChain `getPodLogs` reads the same override until ticket
  14 deletes it.
- Tests: 5 agent host tests (restart turned off, `getClusterVersion` turned
  on, a change applying to the next call, the pod logs import, pod logs asking
  by default) and 4 helper tests.
