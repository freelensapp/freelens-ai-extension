# 04: A dry-run preview on approval cards

**What to build:** before asking about a kubectl invocation whose verb
supports a server-side dry run, the approval gate runs the dry run. The card
then shows what the cluster would actually become, as a diff per target. A
change the server rejects fails without asking, with the server's message for
the agent. When no preview can be made, the card says so and still asks.

See the spec, "The approval gate", and ADR 0003.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] For an Ask or Always ask invocation whose verb is on the dry-run list,
      the gate runs the same invocation with `--dry-run=server -o yaml`, and
      `get -o yaml` for each named target.
- [ ] A dry run rejected by the server (Invalid, Forbidden, NotFound,
      AlreadyExists, Conflict, an admission webhook that denied the request)
      blocks the call with the server's message, and no card is shown.
- [ ] A dry run that cannot be made (a webhook without dry-run support, an API
      without `dryRun`, a connection error, a timeout, an internal error,
      unrecognized output) still asks. The card says "Preview unavailable"
      with the reason and shows the current YAML of the named target, when
      there is one, as the backup.
- [ ] Otherwise the card shows a diff per target, current against dry run,
      without managed fields.
- [ ] The approval request's preview is either the diffs or "unavailable"
      with the reason and an optional backup. The snapshot keeps it.
- [ ] The gate's own invocations use the runner and pi's signal, end on Stop,
      and are not shown in the chat as tool calls. Writes at level Allow get no
      dry run.
- [ ] Agent host tests cover the diff, the rejected dry run, "Preview
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
