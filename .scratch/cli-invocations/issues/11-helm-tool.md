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

- [x] A `helm` tool with the same parameters runs the binary of
      `Main.Shell.getHelmPath(clusterId)` through the same runner.
- [x] The invocation policy parses helm: its global flags, its verbs of
      several words, canonical forms with the resource `releases` (and
      `charts` for `show` and `search repo`), and its floor entries
      (`--kube-*` flags, `registry login`, `repo add`, local chart paths and
      URLs, `--post-renderer`).
- [x] The shipped profiles gain the helm rules of the spec, `helm uninstall *`
      Always ask included.
- [x] `upgrade` and `rollback` get helm's server-side dry run on the approval
      card, with the same rejection and "Preview unavailable" rules.
- [x] The tool card, the approval card and the `cli_policy` section cover
      helm.
- [x] Table-driven policy tests and agent host tests cover helm.
- [ ] Checked in Freelens dev: the agent lists the releases of the cluster and
      shows the history of one.

## Comments

Built on `cli/11`. The flag tables follow `helm <command> --help` of helm
4.3.1, the helm of the Freelens checkout
(`freelens/binaries/client/linux/x64/helm`; the Freelens installed in
`/opt/Freelens` bundles 4.2.2). The behaviour of the dry runs follows the helm
4.3.1 sources (`pkg/cmd/upgrade.go`, `status.go`, `history.go`,
`pkg/action/rollback.go`, `upgrade.go`).

Decisions taken while building it:

1. **One parser for both programs.** The kubectl parser became
   `parseCliInvocation` of `cli-invocation.ts`, over a command table per
   program (`kubectl-commands.ts`, `helm-commands.ts`); `parseKubectlInvocation`
   and its types stay. `CliProgram` is `"kubectl" | "helm"`, with the list
   `CLI_PROGRAMS` next to it.
2. **The verbs.** The parser takes `list`, `status`, `history`, `get values`,
   `get manifest`, `get notes`, `show all|chart|crds|readme|values` (verb
   `show`, alias `inspect`), `search repo`, `rollback`, `uninstall` (aliases
   `del`, `delete`, `un`) and `upgrade`, with their aliases (`ls`, `hist`). The
   floor rejects `registry login` and `repo add` (credentials and
   configuration) and `plugin`, `pull`, `push`, `package`, `create`, `lint`,
   `dependency`, `verify` and `repo index` (the user's disk and local code);
   any other word is a plugin, as for kubectl. `install`, `template`, `test`,
   `version`, `env`, `completion`, `help`, `get all|hooks|metadata`,
   `search hub` and the other `repo` and `registry` subcommands are "not
   supported" (`unparseable`).
3. **upgrade** takes `RELEASE CHART`, needs `--reuse-values` ("helm upgrade
   needs --reuse-values, so that it keeps the values of the release and
   changes only those that --set gives"; without it helm drops the release's
   values once `--set` is given), and otherwise takes only `--set` and
   `--dry-run`. Every other flag of `upgrade --help` is "not supported",
   `--version` and `--install` included, so an upgrade takes the chart's
   latest version from the repository, which the card's diff shows.
4. **Charts.** A chart (of `upgrade` and `show`) is named only as
   `<repository>/<chart>`; a bare name (which helm reads as a local
   directory), a path, a `.tgz`, `oci://` or another URL is rejected under
   `local-disk-or-code`, and so are `--repo`, `-f`/`--values`, `--set-file`,
   `--post-renderer`, `--post-renderer-args`, `--keyring`, `--ca-file`,
   `--cert-file`, `--key-file` and the global `--repository-config`,
   `--repository-cache`, `--registry-config` and `--content-cache`. The
   `--kube-*` flags and `--kubeconfig` are rejected under
   `cluster-or-identity`. The floor entries' `covers` name them, and the
   `unparseable` entry names the upgrade rule and the supported verbs.
5. **Canonical forms.** `helm list releases * -n <ns>` (`-n *` with `-A`),
   `helm <verb> releases <release> -n <ns>` for `status`, `history`,
   `get values|manifest|notes`, `rollback` and `upgrade`, one per release for
   `uninstall`, `helm show charts <repository>/<chart>` without a namespace,
   and `helm search repo charts *` (the keyword is not a name). A release
   without `-n` gets the namespace of the cluster's kubeconfig, which the gate
   reads, with the resource catalog, before the chat's first call of either
   tool. `revealSecrets` names no helm target, and a `manifest` with helm is
   rejected under `manifest`. In a rule, `helm get` and `helm search` are
   verbs of two words, and a helm resource is not normalized through the
   cluster's catalog.
6. **Shipped profiles.** Read only (and so Standard and Permissive) allows
   `helm list *`, `helm status *`, `helm history *`, `helm get values *`,
   `helm get manifest *`, `helm get notes *`, `helm show *` and
   `helm search repo *`; Standard and Permissive always ask for
   `helm uninstall *`; Permissive allows `helm upgrade *` and
   `helm rollback *`. Nothing in the policy says that `get values` hides
   anything: Helm values are not redacted (out of scope).
7. **The preview.** `DRY_RUN_VERBS.helm` holds `upgrade` (takes `-o`) and
   `rollback` (prints no release). `previewHelmInvocation`
   (`src/main/agent/tools/helm-preview.ts`) runs the call with
   `--dry-run=server` (and `-o json` for `upgrade`), then reads
   `helm get manifest <release> -n <ns>`. The upgrade's diff is that manifest
   against the `manifest` of the release the dry run prints. A rollback's dry
   run only checks the release and the revision, so its diff is the current
   manifest against `get manifest --revision <n>` of the revision it goes
   back to: the one it names, else the latest of
   `helm history <release> -n <ns> --max 1 -o json` minus one, as helm takes
   it. Manifests are compared as text, with one final newline. A failed dry
   run whose error says the call would fail the same way (release not found,
   no deployed releases, no such revision, a template or validation error,
   invalid, forbidden, already exists, a conflict, an admission webhook that
   denied the request) blocks the call with "The cluster rejected a
   server-side dry run of this call, so it did not run: ..." and nobody is
   asked; any other failure, a timeout or output it does not recognize is
   "Preview unavailable" with the reason and the current manifest as the
   backup. The kubectl preview's rules (no dry run at Allow or under "Approve
   all in this chat", Stop blocks without a card, the preview reaches the
   card only) hold for helm.
8. **Main.** The runner runs `Main.Shell.getHelmPath(clusterId)` for helm
   (never downloaded, so no progress), with the cluster's environment. The
   gate has one path for both tools (`gateCliCall`) and records what it let
   through in `passedCliCalls` with the program; `tools/kubectl.ts` became
   `tools/cli-tool.ts` (`runCliTool`), `tools/kubectl-policy.ts` became
   `tools/block-reasons.ts`, and the previews share
   `tools/preview-invocation.ts`. The stand-in CLI counts helm's
   `get manifest` and `history --max 1 -o json` reads as previews.
9. **Prompt and cards.** The system prompt's `<kubectl>` section is now
   `<kubectl_and_helm>`, and says that a workload that helm manages changes
   through helm. `cli_policy` names both programs and helm's target shapes,
   and is set when either tool is present. The tool card shows a helm call as
   its command line, like kubectl; the approval card needed no change. The
   profile views and the rule hint name helm.

Open risk: the tool's timeout (30 s unless the call sets one) kills helm in
the middle of a long upgrade, rollback or uninstall, which leaves the release
pending (`another operation is in progress`). The helm tool's description
asks the model to set `timeoutSeconds` for its changes.

Manual check in Freelens dev, still to run: install the checkout in place on
`kind-kind` with Flux (or with a release installed by hand, for example
`helm install podinfo podinfo/podinfo -n default` after
`helm repo add podinfo https://stefanprodan.github.io/podinfo`), connect a
provider and choose a model. In a chat:

- "list the helm releases of the cluster": the tool card shows
  `helm list -A` (or with `-n`), without an approval under Standard, and the
  answer names the releases;
- "show the history of podinfo": `helm history podinfo -n <ns>` runs without
  a card and the answer lists its revisions;
- "scale podinfo to 2 replicas through helm": the card shows
  `helm upgrade podinfo podinfo/podinfo --reuse-values --set replicaCount=2`,
  the target `helm upgrade releases podinfo -n <ns>`, and under "What the dry
  run changes" the manifest diff with the replicas; deny it;
- "roll podinfo back": the card shows the diff to the previous revision; deny
  it;
- "uninstall podinfo": the card says Always ask and has no "Approve all in
  this chat"; deny it;
- "upgrade podinfo from ./chart": the tool card shows "blocked" with the
  floor entry for the user's disk;
- no error in DevTools of the cluster frame, and none of the `freelens-ai`
  scope in main's log.
