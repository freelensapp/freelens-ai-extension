# 04: A dry-run preview on approval cards

**What to build:** before asking about a kubectl invocation whose verb
supports a server-side dry run, the approval gate runs the dry run. The card
then shows what the cluster would actually become, as a diff per target. A
change the server rejects fails without asking, with the server's message for
the agent. When no preview can be made, the card says so and still asks.

See the spec, "The approval gate", and ADR 0003.

**Blocked by:** 03

**Status:** ready-for-agent

- [x] For an Ask or Always ask invocation whose verb is on the dry-run list,
      the gate runs the same invocation with `--dry-run=server -o yaml`, and
      `get -o yaml` for each named target.
- [x] A dry run rejected by the server (Invalid, Forbidden, NotFound,
      AlreadyExists, Conflict, an admission webhook that denied the request)
      blocks the call with the server's message, and no card is shown.
- [x] A dry run that cannot be made (a webhook without dry-run support, an API
      without `dryRun`, a connection error, a timeout, an internal error,
      unrecognized output) still asks. The card says "Preview unavailable"
      with the reason and shows the current YAML of the named target, when
      there is one, as the backup.
- [x] Otherwise the card shows a diff per target, current against dry run,
      without managed fields.
- [x] The approval request's preview is either the diffs or "unavailable"
      with the reason and an optional backup. The snapshot keeps it.
- [x] The gate's own invocations use the runner and pi's signal, end on Stop,
      and are not shown in the chat as tool calls. Writes at level Allow get no
      dry run.
- [x] Agent host tests cover the diff, the rejected dry run, "Preview
      unavailable" with and without a backup, and Stop during the dry run.
- [ ] Checked in Freelens dev: scaling a Deployment shows a diff of
      `spec.replicas`, and patching with an invalid field fails without a
      card.

## Comments

From ticket 02 (see its Comments):

- Read `DRY_RUN_VERBS` of `src/common/invocation-policy/dry-run-verbs.ts`
  rather than hard-coding the verbs. Its `acceptsYamlOutput` says whether
  the gate can add `-o yaml`: it must leave `-o yaml` out for `cordon`,
  `uncordon` and `drain`, which take no `-o`, and for `delete`, which takes
  only `-o name`.
- `rollout restart` has no `--dry-run` in kubectl 1.36, so it is not on the
  list and is asked without a preview. No other verb was removed.

Ticket 03 removed `src/common/invocation-policy/dry-run-verbs.ts` (the
`DRY_RUN_VERBS` list with its `acceptsYamlOutput` facts) and its test cases
("the dry-run verbs" in `invocation-policy.test.ts`), since knip's production
pass reported the file as unused until this ticket imports it. Restore both
from commit 4a2697d, the parent of the removal:
`git checkout 4a2697d -- src/common/invocation-policy/dry-run-verbs.ts` and
the `describe("the dry-run verbs")` block with its `dryRunVerbOf` helper and
the `DRY_RUN_VERBS` import from
`git show 4a2697d:src/common/invocation-policy/invocation-policy.test.ts`.

Built on `cli/04`. The preview is `previewKubectlInvocation` in
`src/main/agent/tools/kubectl-preview.ts`, called from `gateKubectl` in
`src/main/agent/agent-host.ts` after the Allow and "Approve all in this chat"
returns, before the card is built; the line diff is
`src/main/agent/tools/line-diff.ts`.

Decisions taken while building it, approved by the supervisor:

1. **The request's preview** is `CliApprovalRequest.preview`:
   `{ kind: "diffs"; diffs: { target: CanonicalForm; diff: string }[] }` or
   `{ kind: "unavailable"; reason: string; backup?: string }`. A verb not on
   the dry-run list (`exec`, `rollout restart`, ...) gets no `preview`. The
   diff is a unified line diff of the YAML, `--- current` / `+++ dry run`,
   three lines of context, `metadata.managedFields` left out of both sides;
   empty when nothing changes (the card says "no change"). It is our own
   small diff (common prefix and suffix, then the longest common
   subsequence, with a size cap that falls back to every line removed and
   added), not a new dependency. Several backups are joined as
   multi-document YAML.
2. **The preview reaches the card only**: never the model's context, the tool
   result or the session JSONL, since the dry run and the current objects can
   hold Secret values. A Secret target's diff on the card is fine. A test
   asserts that the tool result and the chat's file hold none of it.
3. **The dry run** is the call's own arguments as they will run (`-f -`
   included, the manifest on standard input) with `--dry-run=server` and
   `-o yaml` added before any `--`; the values given last win over the
   agent's own. `delete` gets `-o name`, `cordon`, `uncordon` and `drain` no
   `-o`. It runs first; the reads follow unless the server rejected it.
4. **Rejected** (blocks, no card): a failed dry run whose standard error says
   `Error from server (Invalid|Forbidden|NotFound|AlreadyExists|Conflict)` or
   `admission webhook "..." denied the request`. The model and the tool card
   get "The cluster rejected a server-side dry run of this call, so it did
   not run: " and the standard error. Every other failure, a timeout, a
   runner that cannot start, or output the preview cannot read is "Preview
   unavailable" with the reason, and the card still asks.
5. **The current objects** are read with
   `kubectl get <resource> <name> [-n <namespace>] -o yaml` for each named
   target (not `reveal` forms; the resource as the canonical form names it).
   NotFound means it does not exist yet, so the diff starts from empty (a
   create). Any other failed read makes the preview unavailable with that
   read's error.
6. **Verbs without `-o yaml`**: a named `delete` shows each target's current
   YAML removed in full. `cordon`, `uncordon` and `drain` show "Preview
   unavailable: kubectl cordon prints no object in a dry run" with the
   node's current YAML as the backup.
7. **Targets without a name** (a selector, `--all`, `-A`, no name): their
   current objects are not read. The card says "Preview unavailable: the
   targets are not all named (a selector, --all or no name), so their current
   objects are not read; the dry run reports N objects: pods/a, pods/b, ..."
   with the names from the dry run (the List items of `-o yaml`, the lines of
   `-o name` for delete), at most 50 and "and N more"; without names, the
   first part only.
8. **Unrecognized output**: output that does not parse as YAML objects, or
   that holds no object for a named target (matched by resource, name and
   namespace), is "kubectl printed a dry run the preview does not
   recognize".
9. **Stop** during the dry run or the reads ends them through pi's signal and
   blocks the call with "The user denied the action", without a card.
10. **No dry run** at Allow, nor for an Ask call that "Approve all in this
    chat" lets through: nobody is asked, so there is no card to fill.
11. **Test support.** The stand-in CLI's `actions()` now also leaves out the
    gate's previews, which `previews()` returns: the invocations with
    `--dry-run=server` and the reads `get <resource> <name> [-n <ns>] -o
    yaml`. A test of the agent's own reads uses another output.

Manual check in Freelens dev, still to run: install the checkout in place on
`kind-kind` with Flux, connect a provider and choose a model. In a chat:

- "scale the deployment podinfo to 3" (or any Deployment): the card shows,
  under "What the dry run changes", the target's diff with
  `-  replicas: 1` / `+  replicas: 3` and no `managedFields`; approve, and the
  tool result shows only kubectl's own output;
- "patch podinfo with an invalid field, spec.replicas: -1": no card; the tool
  card shows "blocked" and "The cluster rejected a server-side dry run of
  this call, so it did not run: The Deployment ... is invalid: ...";
- "delete the pods with label app=podinfo": the card says "Preview
  unavailable: the targets are not all named ..." and lists the pods;
- "cordon one of the nodes": the card says "Preview unavailable: kubectl cordon prints
  no object in a dry run", with "Current YAML" folded;
- "restart podinfo" (`rollout restart`): a card without a preview;
- press Stop while the card is being prepared on a slow cluster: no card, the
  tool card says the user denied it;
- with a validating webhook that has `sideEffects: Unknown` (no dry-run
  support) on Deployments: a scale still asks, with "Preview unavailable:
  the dry run failed: ... does not support dry run" and the current YAML;
- reopen the chat page while a card with a diff is pending: the diff comes
  back;
- no error in DevTools of the cluster frame, and none of the `freelens-ai`
  scope in main's log; the chat's JSONL holds no dry-run YAML.
