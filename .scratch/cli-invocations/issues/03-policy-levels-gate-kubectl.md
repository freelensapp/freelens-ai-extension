# 03: The floor and the policy levels gate kubectl invocations

**What to build:** every `kubectl` call goes through the invocation policy
before it runs, with Standard as the policy profile of every cluster for now
(ticket 06 makes it configurable). The floor and Deny block a call with the
reason. Allow runs it without asking. Ask and Always ask show the new approval
card. The agent knows the policy from its prompt.

See the spec, "The approval gate" (without the dry run, which is ticket 04),
"The system prompt" (the `cli_policy` section) and "Renderer" (tool card,
approval card).

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] pi's `tool_call` hook runs the invocation policy for every `kubectl`
      call. A floor rejection or Deny blocks it with the reason, Allow runs it,
      Ask asks unless "Approve all in this chat" is on, and Always ask always
      asks. The per-tool approval setting no longer applies to `kubectl`.
- [ ] The resource catalog comes from `kubectl api-resources` of the cluster,
      run through the same runner. It is kept for the cluster's session and
      refreshed when a resource is not found. The default namespace is the one
      the cluster's environment selects, or `default`.
- [ ] The agent protocol's approval request carries the program, the
      arguments, the manifest, the canonical forms, the policy level and the
      profile name. The snapshot keeps a pending request and a remounted frame
      shows it again. The old tools keep their existing requests until
      ticket 07.
- [ ] The approval card shows the command line, the targets, the profile and
      level, and the manifest. "Approve all in this chat" is not offered for
      Always ask, and an approval given with it never covers a later Always
      ask.
- [ ] The tool card of a blocked call shows the reason: the floor entry, Deny
      of the profile, or the user's denial.
- [ ] The `cli_policy` section is set in `before_agent_start` before every
      run. It names the profile, lists its rules and fallback level, and
      summarizes the floor.
- [ ] Agent host tests cover a floor rejection and Deny that never reach the
      stand-in CLI, Allow, Ask, Always ask with and without "Approve all in
      this chat", Stop during an approval, and the `cli_policy` section.
- [ ] Checked in Freelens dev: `get` runs without a card, `scale` asks,
      `exec` asks even after "Approve all in this chat", and `--context`
      is blocked with its reason.
