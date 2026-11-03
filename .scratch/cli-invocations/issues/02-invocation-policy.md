# 02: The invocation policy

**What to build:** the pure function that decides what happens to a kubectl
CLI invocation. It takes the program, the arguments, the manifest,
`revealSecrets`, a policy profile and a resource catalog. It returns either a
floor rejection with the floor entry that rejected it, or the canonical forms,
the policy level and the rule that matched each canonical form. It lives in
common code, reaches no Node, pi or DOM API, and is used by main (ticket 03)
and by the test box of the preferences (ticket 09). Helm is added in
ticket 11.

See the spec, "The invocation policy (a pure module in common)" and "Policy
profiles and their storage" (the shipped profiles).

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The parser knows kubectl's global flags, which flags take a value, and
      the verbs of several words. It accepts every spelling of a flag and
      `<resource>/<name>`, and rejects an argument it cannot place instead of
      guessing.
- [x] Resource names map to the plural names of the given resource catalog:
      short names, singulars, kinds and group-qualified names. A built-in
      catalog of the Kubernetes kinds is exported for callers without a
      cluster.
- [x] Canonical forms: one per resource and name, and one per manifest object.
      The name is `*` for a selector, `--all` or no name. The namespace is `*`
      for `-A`. A cluster-scoped resource has no namespace. A namespaced
      resource without `-n` gets the given default namespace. With
      `revealSecrets`, a read of Secrets has the verb `reveal`.
- [x] Every kubectl entry of the floor in the spec rejects with a reason
      naming the entry: flags that change the cluster or identity, credentials
      and configuration verbs, disk and local code (including verbs that are
      not kubectl verbs, which kubectl would take for plugins), invocations
      that never end or need a terminal, value-printing output formats on
      Secrets without `revealSecrets`, and unparseable or misplaced manifests.
- [x] Rule matching: patterns with the shape of the canonical form, made of
      literals, globs and `*`, with omitted trailing parts meaning `*`. A
      canonical `*` name or namespace matches only `*` or omitted parts.
      Specificity weights are 2 for a literal, 1 for a glob and 0 for `*`. A
      tie goes to the most restrictive level. The fallback level applies when
      no rule matches. The invocation's level is the most restrictive level
      among its canonical forms.
- [x] The kubectl rules of the three shipped profiles (Read only, Standard,
      Permissive) are defined with fixed ids, as in the spec.
- [x] The internal list of dry-run verbs is exported.
- [x] Table-driven tests cover the spellings, the multi-target cases, every
      floor entry, specificity and its ties, the fallback, `reveal`, and one
      invocation per shipped profile and level.

## Comments

Decisions taken while building it, approved by the supervisor:

1. **Writes that print the object.** Without `revealSecrets`, the Secret
   output-format floor entry (`secret-output`) also rejects any
   object-printing output on a verb other than `get` whose targets include
   `secrets`, manifest objects included: any `-o` but `name`, `--template`,
   and `diff --show-secrets`. With `revealSecrets`, such an invocation gets
   an extra canonical form `kubectl reveal secrets <name> -n <ns>` next to
   each of its Secret forms, so the profile decides the reveal.
2. **Verbosity.** `-v`/`--v` at 6 or higher and `--vmodule` are rejected
   under the `credentials-or-configuration` entry. Its reason says that from
   level 7 verbose logging prints the request headers, the bearer token
   included, and from level 8 the response bodies, Secret values included.
3. **Every flag must be known to the parser.** Unknown flags are rejected
   under the entry `unparseable`, with a reason that names the flag and says
   it is not supported, so that the agent can run the invocation without it.
   The per-verb flag tables in `kubectl-commands.ts` were compared with
   `kubectl <verb> --help` of kubectl 1.36.5 for every command they hold:
   they differ only in the flags left out on purpose (`--raw`, `apply --prune`,
   `--all` and `--prune-allowlist`, `diff --prune` and `--prune-allowlist`,
   `set env --resolve`), which reach objects the canonical forms would not
   name. `-o *-file` and `-o templatefile`, `--patch-file`, `--profile`,
   `--profile-output`, `--kuberc`, `create secret tls --cert/--key` and
   `cluster-info dump --output-directory` are rejected under
   `local-disk-or-code`. Explicit false values (`--watch=false`) pass.
4. **Extra floor entries** `unparseable` and `unknown-resource`. The latter
   lets ticket 03 refresh the resource catalog and evaluate again.
5. **Canonical verbs.** The verb of every `set X` is `set`, of every
   `create X` is `create`, of `top pod` and `top node` is `top`.
6. **Rule patterns.** A literal resource in a pattern is normalized through
   the catalog, so `kubectl delete ns *` matches the resource `namespaces`.
   A pattern that does not have the shape of a canonical form (an unknown
   flag, too many parts) never matches. `kubectl rollout` and
   `kubectl rollout *` match every rollout verb, the verb counting as a
   glob.
7. **Shipped profiles** have the ids `read-only`, `standard` and
   `permissive`, and hold kubectl rules only until ticket 11. In Permissive,
   `kubectl logs *` is Allow in place of the Ask of Read only (a tie would
   otherwise keep Ask).

Deviation from the spec, approved by the supervisor: `rollout restart` is not
on the dry-run list. `kubectl rollout restart --help` of kubectl 1.36.5 has
no `--dry-run`, and what the CLI's help says wins over the spec. Every other
verb on the list was checked the same way (every `set` and `create`
subcommand included) and has `--dry-run`. The list also says, per verb,
whether it takes `-o yaml` (`acceptsYamlOutput`, since replaced by
`output`): `delete` takes only `-o name`, and `cordon`, `uncordon` and
`drain` take no `-o`.

Other notes:

- A flag written before a subcommand (`kubectl create -n web deployment api`)
  is rejected with "write kubectl create deployment before the flags":
  once the verb words name a command, a flag ends them, so that `logs -f`
  reads as `--follow`.
- The built-in catalog holds the kinds that Kubernetes 1.36 serves by
  default, the `resource.k8s.io` kinds and `VolumeAttributesClass` included.
- knip's production pass reports the module's files as unused until
  ticket 03 imports it from main.
