# 09: The test box and the floor in the preferences

**What to build:** in the profile editor, the user types an invocation as a
command line and sees how the selected profile treats it: its canonical forms,
the rule that matched each, and the resulting level, or the floor entry that
rejects it. The floor is listed read-only with the reason for each entry.

See the spec, "Renderer" (profile editor).

**Blocked by:** 08

**Status:** ready-for-agent

- [x] The test box splits the command line into arguments, calls the same
      invocation policy as main with the built-in resource catalog, and shows
      the canonical forms, the matching rule of each, and the level, or the
      floor entry and its reason.
- [x] The floor is listed read-only with the reason for each entry, from the
      same definitions the policy uses.
- [x] View tests in jsdom cover an Allow, an Ask from a specific rule over a
      broad one, a fallback, a multi-target invocation and a floor rejection.

## Comments

Decisions:

- **Splitting the command line.** `splitCommandLine` of
  `src/common/utils/split-command-line.ts` reads the words by the quoting
  rules of a POSIX shell alone: single quotes keep their text, a backslash in
  double quotes escapes `"`, `\`, `$` and a backquote, and one outside quotes
  keeps the next character. Nothing is expanded, so `$NS`, `*`, `~`, `$(...)`
  and `;` reach the policy as typed. An unclosed quote or a trailing backslash
  is shown as the reason the line cannot be tested. It reads back what
  `formatCommandLine` of the cards writes, `'\''` included.
- **The program from the command line.** The first word must name a CLI the
  agent runs (`isCliProgram` of `canonical-form.ts`), else the box says
  "Start the command line with kubectl or helm.". The names come from
  `CLI_PROGRAMS`, the list ticket 11 added, which `CliProgram` is derived
  from, so a program added there reaches the test box with no other change.
  The floor list reads `FLOOR_ENTRIES` and needs none.
- **What the box evaluates with.** `evaluateInvocationPolicy` with
  `BUILT_IN_RESOURCE_CATALOG`, the namespace `default` for a namespaced
  target without `-n`, no manifest and `revealSecrets: false`. The hint under
  its title says that custom resources are not known there and how a missing
  `-n` is read.
- **The result updates as the user types**, with no button: the policy is
  pure and fast, and an empty line shows nothing. It is an `<output>` (role
  status) under the field: the overall level, then a table of canonical form,
  matching rule ("None, fallback level" when no rule matched) and level; or
  "Rejected by the floor" with the policy's reason and the entry's reason.
- **The command line stays when another profile is chosen**, so one line can
  be compared across profiles. Its state lives in `PolicyProfileSettings` and
  reaches the box through `ProfileDetails`, which is keyed by the profile.
- **The floor list** is a section after the editor grid: each entry's title
  and reason, and what it rejects in a collapsed "What it rejects" list.
- Not done: flagging rule patterns that match nothing (the handover of ticket
  08 suggested exporting `parsePattern`); it is not a criterion of this
  ticket.
- The README does not describe the profile editor yet (ticket 08 left it
  out too), so this ticket adds nothing there; AGENTS.md's "Preferences"
  bullet names the test box and the floor list.

Manual check in Freelens dev (not run; Freelens dev was not running):

1. `pnpm build`, open Preferences, Freelens AI, "Policy profiles".
2. With Standard chosen, type `kubectl get pods -n web` in "Test a command
   line": "Policy level: Allow", one row `kubectl get pods * -n web`, rule
   `kubectl get *`, Allow.
3. Type `kubectl scale deployment api --replicas=2`: Ask, "None, fallback
   level", form `kubectl scale deployments api -n default`. Choose Read only in
   the list: the line stays and the level becomes Deny.
4. Create a user profile with `kubectl delete *` Allow and
   `kubectl delete pods * -n prod` Ask; type `kubectl delete pod web -n prod`:
   Ask from the specific rule.
5. Type `kubectl delete pod/web deployment/api -n dev`: two rows, the overall
   level the most restrictive of them.
6. Type `kubectl get pods --kubeconfig /tmp/x`: "Rejected by the floor" with
   the reason. Type `kubectl get pods -l 'app=web`: "The single quote is not
   closed.". Type `oc get pods`: "Start the command line with kubectl or helm.".
7. Below the editor, "Floor" lists every entry with its reason; "What it
   rejects" opens the list of flags and cases. Check both themes, and that
   DevTools of the root frame shows no error.
