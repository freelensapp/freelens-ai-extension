# 11: The helm tool

**What to build:** the agent can also run CLI invocations of helm against the
chat's cluster: read releases, their status, history, values and manifests,
and roll back, upgrade with changed values or uninstall them, through the same
runner, floor, policy profiles, approval gate and dry-run preview as kubectl.
This is the third delivery slice.

See the spec, "The two tools", "The invocation policy" (helm's canonical
forms and floor entries) and "Policy profiles and their storage".

**Blocked by:** 04, 07

**Status:** ready-for-agent

- [ ] A `helm` tool with the same parameters runs the binary of
      `Main.Shell.getHelmPath(clusterId)` through the same runner.
- [ ] The invocation policy parses helm: its global flags, its verbs of
      several words, canonical forms with the resource `releases` (and
      `charts` for `show` and `search repo`), and its floor entries
      (`--kube-*` flags, `registry login`, `repo add`, local chart paths and
      URLs, `--post-renderer`).
- [ ] The shipped profiles gain the helm rules of the spec, `helm uninstall *`
      Always ask included.
- [ ] `upgrade` and `rollback` get helm's server-side dry run on the approval
      card, with the same rejection and "Preview unavailable" rules.
- [ ] The tool card, the approval card and the `cli_policy` section cover
      helm.
- [ ] Table-driven policy tests and agent host tests cover helm.
- [ ] Checked in Freelens dev: the agent lists the releases of the cluster and
      shows the history of one.
