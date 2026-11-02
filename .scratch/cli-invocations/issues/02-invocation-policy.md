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

**Status:** ready-for-agent

- [ ] The parser knows kubectl's global flags, which flags take a value, and
      the verbs of several words. It accepts every spelling of a flag and
      `<resource>/<name>`, and rejects an argument it cannot place instead of
      guessing.
- [ ] Resource names map to the plural names of the given resource catalog:
      short names, singulars, kinds and group-qualified names. A built-in
      catalog of the Kubernetes kinds is exported for callers without a
      cluster.
- [ ] Canonical forms: one per resource and name, and one per manifest object.
      The name is `*` for a selector, `--all` or no name. The namespace is `*`
      for `-A`. A cluster-scoped resource has no namespace. A namespaced
      resource without `-n` gets the given default namespace. With
      `revealSecrets`, a read of Secrets has the verb `reveal`.
- [ ] Every kubectl entry of the floor in the spec rejects with a reason
      naming the entry: flags that change the cluster or identity, credentials
      and configuration verbs, disk and local code (including verbs that are
      not kubectl verbs, which kubectl would take for plugins), invocations
      that never end or need a terminal, value-printing output formats on
      Secrets without `revealSecrets`, and unparseable or misplaced manifests.
- [ ] Rule matching: patterns with the shape of the canonical form, made of
      literals, globs and `*`, with omitted trailing parts meaning `*`. A
      canonical `*` name or namespace matches only `*` or omitted parts.
      Specificity weights are 2 for a literal, 1 for a glob and 0 for `*`. A
      tie goes to the most restrictive level. The fallback level applies when
      no rule matches. The invocation's level is the most restrictive level
      among its canonical forms.
- [ ] The kubectl rules of the three shipped profiles (Read only, Standard,
      Permissive) are defined with fixed ids, as in the spec.
- [ ] The internal list of dry-run verbs is exported.
- [ ] Table-driven tests cover the spellings, the multi-target cases, every
      floor entry, specificity and its ties, the fallback, `reveal`, and one
      invocation per shipped profile and level.
