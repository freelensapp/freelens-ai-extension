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

**Status:** resolved (HITL check pending: manual-test-cases.md)

- [x] pi's `tool_call` hook runs the invocation policy for every `kubectl`
      call. A floor rejection or Deny blocks it with the reason, Allow runs it,
      Ask asks unless "Approve all in this chat" is on, and Always ask always
      asks. The per-tool approval setting no longer applies to `kubectl`.
- [x] The resource catalog comes from `kubectl api-resources` of the cluster,
      run through the same runner. It is kept for the cluster's session and
      refreshed when a resource is not found. The default namespace is the one
      the cluster's environment selects, or `default`.
- [x] The agent protocol's approval request carries the program, the
      arguments, the manifest, the canonical forms, the policy level and the
      profile name. The snapshot keeps a pending request and a remounted frame
      shows it again. The old tools keep their existing requests until
      ticket 07.
- [x] The approval card shows the command line, the targets, the profile and
      level, and the manifest. "Approve all in this chat" is not offered for
      Always ask, and an approval given with it never covers a later Always
      ask.
- [x] The tool card of a blocked call shows the reason: the floor entry, Deny
      of the profile, or the user's denial.
- [x] The `cli_policy` section is set in `before_agent_start` before every
      run. It names the profile, lists its rules and fallback level, and
      summarizes the floor.
- [x] Agent host tests cover a floor rejection and Deny that never reach the
      stand-in CLI, Allow, Ask, Always ask with and without "Approve all in
      this chat", Stop during an approval, and the `cli_policy` section.
- [ ] Checked in Freelens dev: `get` runs without a card, `scale` asks,
      `exec` asks even after "Approve all in this chat", and `--context`
      is blocked with its reason.

## Comments

Built on `cli/03`. The gate is `gateKubectl` in `src/main/agent/agent-host.ts`,
reached from the top of `gate()`; the old tools keep their path below it until
ticket 07.

Decisions taken while building it:

1. **The cluster's resources and namespace** are two CLI invocations of the
   gate itself, through the same runner and pi's signal, with the default
   timeout: `kubectl api-resources -o wide` (parsed by the header's column
   offsets, so empty cells and both verb spellings read right; a table with
   an error exit, as kubectl prints on a partial discovery failure, is used)
   and `kubectl config view --minify -o jsonpath={..namespace}` (empty,
   invalid or failed: `default`). They run before the chat's first kubectl
   call and are kept on the chat's `ClusterAgent`, so New chat reads them
   again. The gate's own invocations are not subject to the floor.
2. **Refresh.** On the `unknown-resource` floor entry the catalog is read
   again once and the call evaluated again, unless it was read for this very
   call (the chat's first).
3. **A catalog that cannot be read blocks the call** with "Could not read the
   resources the cluster serves: ..." rather than falling back to the built-in
   catalog, which would not know the cluster's CRDs.
4. **A floor rejection on the chat's first call** still runs the two reads,
   since the policy takes the catalog as input; the call itself never runs
   (`actions()` of the stand-in CLI is empty in those tests).
5. **Download progress.** The kubectl download now happens in the gate's
   first read, where pi hands no update callback, so the host broadcasts the
   runner's progress as `tool_execution_update` events of the call; the tool
   card shows it as before.
6. **The request's `args`** are the agent's own arguments, before the tool
   adds `-f -` or the logs tail, so the card's command line reads like the
   tool card before the call ran, and the request can be evaluated again.
7. **"Approve all in this chat" on an Always ask answer** approves that call
   and does not turn the setting on.
8. **Block reasons**, which the model gets and the tool card shows:
   `Blocked by the floor, which no policy profile lifts.` followed by the
   entry's title, what it rejected and the entry's reason; and
   `Denied by the policy profile "Read only":` followed by each denied target
   with the rule or the fallback level that denied it, such as
   `kubectl scale deployments web -n default gets Deny from the profile's
   fallback level.` The user's denial stays "The user denied the action".
9. **`cli_policy`** is set only for an agent with the kubectl tool. It names
   the profile, explains the four levels and the specificity, lists every rule
   and the fallback level, and lists every floor entry with what it covers.
10. **The kubectl tool definition** is no longer `mutating` nor approval-gated
    by default, and the preferences' per-tool approval list leaves it out.
11. **The dry-run verb list was removed** (commit "Remove the dry-run verb
    list until the dry run uses it"): only ticket 04 uses it, and knip's
    production pass reports a file only tests import. Ticket 04 restores it
    (see its comments).
12. **Test support.** The stand-in CLI answers the two reads by default
    (`STAND_IN_RESOURCES`, no namespace; overridable by `answers`, which is
    read per invocation), its `actions()` leaves them out, and `progress` is
    reported by the first invocation only, as Freelens downloads kubectl once.
    The fake kubectl answers `api-resources` and `config`, and its hang, fail
    and flood cases are `get pods hang|fail|flood`, which pass the floor; the
    entry test sends its manifest with `diff`, Allow in Standard.

Manual check in Freelens dev, still to run: install the checkout in place on
`kind-kind` with Flux, connect a provider and choose a model. In a chat:

- "list the pods in flux-system": `kubectl get pods -n flux-system` runs
  without a card, and the answer names the pods;
- "scale the deployment podinfo to 2" (or any Deployment): a card with the
  command line as its header, the target `kubectl scale deployments podinfo
  -n <ns>`, "Ask: the policy profile Standard asks before this invocation."
  and the three answers; "Approve all in this chat", then a second scale runs
  without a card;
- in the same chat, "show /etc/hostname inside a flux-system pod": the
  `kubectl exec` card says "Always ask: ..." and offers only yes and no, even
  though "Approve all in this chat" is on;
- "list the pods with --context kind-other": the tool card shows "blocked"
  and "Blocked by the floor, which no policy profile lifts. Flags that change
  the cluster or the identity: --context is never allowed. ..."; no card;
- deny a card: its tool card shows "The user denied the action";
- reopen the chat page while a card is pending: the card comes back;
- no error in DevTools of the cluster frame, and none of the `freelens-ai`
  scope in main's log.
