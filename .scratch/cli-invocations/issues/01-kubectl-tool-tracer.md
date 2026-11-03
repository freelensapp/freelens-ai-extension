# 01: The agent runs kubectl invocations

**What to build:** the agent of a cluster chat can run a CLI invocation of
kubectl against the chat's cluster, end to end, through the real binary. A new
`kubectl` tool sits next to the twelve existing tools, so the chat keeps
working throughout. Until ticket 03 adds the floor and policy levels, the tool
is gated by today's per-tool approval: it requires approval by default, and the
existing generic approval card shows its arguments. Nothing is built that a
later ticket throws away.

See the spec, "The two tools" and "Running a CLI invocation".

**Blocked by:** None (can start immediately).

**Status:** resolved (HITL check pending: manual-test-cases.md)

- [x] The agent's tool list holds a `kubectl` tool with the parameters `args`,
      `manifest`, `grep`, `timeoutSeconds` and `revealSecrets`, marked
      `executionMode: "sequential"`. `revealSecrets` is accepted and has no
      effect until ticket 05.
- [x] The agent host takes a CLI runner as an option. Its request carries the
      cluster id, the program, the arguments, the manifest, the timeout, pi's
      signal and a progress callback. Its answer is standard output, standard
      error and the exit code.
- [x] The real runner runs the binary of `Main.Shell.getKubectlPath(clusterId)`
      with `execFile`, the argument array and the environment of
      `Main.Shell.getEnvironment(clusterId)`, never through a shell. A manifest
      is sent on standard input with `-f -` added by the tool. `-f` and
      `--filename` in `args` are rejected. A manifest with a verb other than
      `apply`, `create`, `replace`, `delete` or `diff` is rejected.
- [x] The timeout defaults to 30 seconds and is capped at 300. Stop (pi's
      signal) and the timeout kill the process, and the error result says
      which of the two happened.
- [x] The result holds the exit code, standard output and standard error. A
      non-zero exit code makes it an error result. `grep` keeps only matching
      lines, before a 256 KiB cap that keeps the head and the tail with a
      marker of how much was cut.
- [x] `kubectl logs` without `--tail`, `--since` or `--since-time` gets
      `--tail=<pod logs tail lines preference>`.
- [x] A call on a cluster that is not connected is the error result "Cluster
      not connected", and no process starts.
- [x] The phases and progress of a kubectl download reach the chat as pi's
      partial tool updates.
- [x] The chat's tool card of a `kubectl` call shows the command line, the
      manifest collapsed, the output collapsed with the exit code, and the
      download progress while it runs.
- [x] Test support gains a stand-in CLI that records every invocation and
      answers by invocation (or hangs until the signal aborts). Agent host
      tests drive the tool through `handleCommand` with it.
- [x] The extension entry test runs the real runner against a fake kubectl, a
      small Node script in the test support, through a stand-in `Main.Shell`.
      It proves the argument array, the environment, the manifest on standard
      input, the kill on Stop and on the timeout, the cap and the error result
      of a non-zero exit code.
- [ ] Checked in Freelens dev: "list the pods in flux-system" runs
      `kubectl get pods -n flux-system` after approval, and the card shows the
      output.

## Comments

Manual check in Freelens dev, still to run (the implementer had no Freelens
dev): install the checkout in place on `kind-kind` with Flux, connect a
provider and choose a model, and leave the `kubectl` approval at its default
(ask). In the chat, ask "list the pods in flux-system". Expected:

- an approval card titled `KUBECTL` whose YAML shows
  `args: [get, pods, -n, flux-system]`; nothing runs before it is approved;
- after "Approve", the tool card shows `kubectl get pods -n flux-system`, and
  its folded "Output, exit code 0" holds the pods of flux-system; the answer
  names them;
- on a first run with a cluster version whose kubectl Freelens has not
  downloaded yet, the tool card shows the download phases and percentage
  while it runs;
- Stop during a long call (ask for `kubectl rollout status` of a deployment
  that does not become ready, with a `timeoutSeconds` of 300) ends it, and
  the card's output says "kubectl was stopped before it ended.";
- no error in DevTools of the cluster frame, and none of the `freelens-ai`
  scope in main's log.

Resolved on `cli-invocations`. The manual check above describes the per-tool
approval card of this ticket, which ticket 03 replaced; run cases A1 to A3 of
`../manual-test-cases.md` instead.
