# Spec: the agent's tools are CLI invocations of kubectl and helm

Status: ready-for-agent

Source: the grilling session that reviewed the twelve cluster tools and
redesigned them, `GLOSSARY.md` (the vocabulary below), and
[ADR 0003](../../docs/adr/0003-agent-tools-are-cli-invocations.md), which
supersedes ADR 0002 for how the tools reach the cluster.

## Problem Statement

The agent of a cluster chat reaches the cluster through twelve hand-written
tools. They cover only a small part of what the user asks for, and some of
what they claim to cover is broken:

- A list cannot be narrowed by label or field selector, and has no limit or
  pagination. Listing the pods of a big cluster floods the chat's context.
- The agent cannot ask which kinds or CRDs the cluster serves. Any kind other
  than Pod, Deployment and Service needs an apiVersion the agent has to guess,
  although the tool's description says kinds are looked up.
- Every object read keeps only its metadata, spec and status. A ConfigMap's
  data, the rules of a Role, the fields of an Event, the usage in PodMetrics
  and the webhooks of a webhook configuration never reach the agent. Secret
  values are hidden only as a side effect of that bug.
- Logs come from one container of one pod, with no time window and no logs
  by workload or label.
- A patch of the main resource is a JSON merge patch, which replaces whole
  lists: changing the image of one container drops the fields of every other
  container.
- Creating a Pod or a Deployment is validated against hand-written schemas
  that reject valid manifests, for example a container without ports.
- There is no server-side apply, no dry run, no JSON patch, no rollout status
  or undo, no cordon or drain, no exec, no metrics, no permission check and
  nothing for Helm releases.
- Every new capability needs a new tool, a schema and an approval case of its
  own. Approvals are set per tool, so one switch covers both scaling a
  Deployment and clearing the finalizers of an object.
- One approval setting applies to every cluster. A user who wants a
  permissive development cluster and a cautious production cluster cannot
  have both.

## Solution

The agent gets two tools, `kubectl` and `helm`. Each runs one CLI invocation
of the real binary against the chat's cluster, through Freelens's connection
to that cluster. The agent can do whatever the two CLIs can do, within limits
the user controls per cluster:

- Every CLI invocation must pass the floor: it stays on the chat's cluster,
  never reveals credentials, never touches the user's disk or runs local code,
  and always ends on its own. No setting lifts the floor.
- Every cluster has one policy profile, which gives each CLI invocation a
  policy level: Allow, Ask, Always ask or Deny. Freelens AI ships three
  profiles (Read only, Standard, Permissive), which cannot be changed. The user
  can create or duplicate profiles, edit them freely and assign them to
  clusters. Standard is the default profile until the user chooses another.
- When a CLI invocation needs approval and its verb supports a server-side dry
  run, the approval card shows what the cluster would actually become, as a
  diff. If the cluster rejects the change, the agent hears why and nobody is
  asked. If a preview cannot be made, the card says so and still asks.
- Secret values stay hidden from the model unless the agent asks to reveal
  them and the profile allows it.
- The chat header shows the cluster's profile, so the user knows what the
  agent may do before typing.

## User Stories

### Reading the cluster

1. As a cluster user, I want the agent to read any kind the cluster serves, built-in or CRD, so that I can ask about any resource without the agent guessing API versions.
2. As a cluster user, I want the agent to narrow lists by label or field selector, so that large clusters do not flood the chat.
3. As a cluster user, I want the agent to read a ConfigMap's data, a Role's rules, an Event's fields and every other top-level field, so that its answers rest on the whole object.
4. As a cluster user, I want the agent to see which kinds and API versions the cluster serves, so that it can work with CRDs it has never seen.
5. As a cluster user, I want the agent to use `describe`, so that it sees an object together with its events, as I would.
6. As a cluster user, I want the agent to read resource usage of pods and nodes, so that it can find what is starving the cluster.
7. As a cluster user, I want the agent to read logs by workload, by label, by time window and from every container, so that troubleshooting does not take a call per container.
8. As a cluster user, I want the agent to keep only the output lines that match a pattern, so that a chatty log or a long list does not fill the context.
9. As a cluster user, I want the agent to check whether an action is permitted before it proposes it, so that it does not plan changes my credentials cannot make.
10. As a cluster user, I want the agent to read rollout status and history, so that it can tell me whether a change has landed.
11. As a cluster user, I want the agent to read Helm releases, their status, history, values and manifests, so that I can ask about what Helm installed.
12. As a cluster user, I want the output of a CLI invocation capped with a clear marker of what was cut, so that one huge answer cannot break the chat.

### Changing the cluster

13. As a cluster user, I want the agent to apply a manifest with server-side apply, so that a change is idempotent and does not overwrite fields it did not mean to touch.
14. As a cluster user, I want the agent to patch with a strategic merge patch, a JSON merge patch or a JSON patch, so that it can change one container or remove one list entry without replacing the rest.
15. As a cluster user, I want the agent to scale, label, annotate, set images, and restart, undo, pause or resume rollouts, so that common operations are one invocation.
16. As a cluster user, I want the agent to cordon, uncordon, drain and taint nodes, so that it can help with node maintenance.
17. As a cluster user, I want the agent to run a command in a container, so that it can inspect a configuration file or test a connection from inside the pod.
18. As a cluster user, I want the agent to roll back, upgrade with changed values, or uninstall a Helm release, so that Helm-managed workloads are changed the way Helm expects.
19. As a cluster user, I want the agent to send a manifest of several objects in one invocation, so that related objects are created together.
20. As a cluster user, I want the agent to make one change at a time and see each result before the next, so that a failed change is not followed by changes built on it.

### Approvals

21. As a cluster user, I want the approval card to show the CLI invocation as a command line, so that I see exactly what will run.
22. As a cluster user, I want the approval card to list every target of the invocation, so that "delete pods a and b in dev" is visible as two targets.
23. As a cluster user, I want the approval card to show the manifest the invocation sends, so that I can read what will be applied.
24. As a cluster user, I want the approval card to show a diff between the current object and what the cluster would make of the change, so that I approve the real result, defaults and webhooks included.
25. As a cluster user, I want a change the cluster would reject to fail without asking me, so that I am never asked to approve something that cannot happen.
26. As a cluster user, I want the agent to get the cluster's rejection message, so that it can correct the change or explain why it is not possible.
27. As a cluster user, I want a card that says "Preview unavailable" with the reason when no dry run can be made, so that a webhook without dry-run support does not block valid changes.
28. As a cluster user, I want the card without a preview to show the current YAML of a named target, so that I can undo the change by hand.
29. As a cluster user, I want "Approve all in this chat" to cover Ask invocations only, so that an exec, a drain or a namespace deletion always asks me.
30. As a cluster user, I want Stop to deny a pending approval and end a running invocation, so that I can halt the agent at any moment.
31. As a cluster user, I want a pending approval to be checked again when the cluster's profile changes, so that switching a cluster to Read only takes effect at once.

### Safety: the floor

32. As a cluster user, I want every CLI invocation to stay on the chat's cluster, so that the agent of my development chat can never reach production through a flag.
33. As a cluster user, I want the agent to be unable to read kubeconfig contents or create tokens, so that my credentials never reach a model provider.
34. As a cluster user, I want the agent to be unable to read or write files on my computer or run local programs, so that the cluster chat cannot become a way into my machine.
35. As a cluster user, I want every invocation to end on its own, with a timeout, so that nothing keeps running after the agent is done.
36. As a cluster user, I want invocations that wait for a terminal, follow output or open a port to be rejected, so that the agent never hangs on them.
37. As a cluster user, I want the floor listed read-only in the settings with the reason for each entry, so that I understand what no profile can allow.

### Secrets

38. As a cluster user, I want Secret values redacted from what the agent reads, so that they are not sent to the model provider by default.
39. As a cluster user, I want a redacted Secret to still show its keys, type and value sizes, so that the agent can reason about it without the values.
40. As a cluster user, I want revealing Secret values to be a separate action that my profile controls, so that I decide when values may leave my machine.
41. As a cluster user, I want output formats that would print Secret values around the redaction to be rejected, so that the redaction cannot be bypassed by asking for jsonpath.

### Policy profiles

42. As a cluster user, I want three shipped profiles, Read only, Standard and Permissive, so that I can protect a cluster without writing rules.
43. As a cluster user, I want shipped profiles to be unchangeable, so that "Read only" always means the same thing.
44. As a cluster user, I want to create a profile empty or as a copy of an existing one, so that I can start from scratch or from a profile close to what I need.
45. As a cluster user, I want to edit every rule of my own profiles, add rules and remove them, so that a profile does exactly what I want.
46. As a cluster user, I want to set a profile's fallback level, so that whatever no rule matches is allowed, asked or denied as I choose.
47. As a cluster user, I want rules written as command patterns such as `kubectl delete pods * -n dev`, so that they read like the invocations they match.
48. As a cluster user, I want the most specific rule to decide when several match, so that I can write an exception to a broad rule without ordering rules.
49. As a cluster user, I want to type an invocation into a test box and see its targets, its level and the rule that decided, so that I never have to guess how a profile behaves.
50. As a cluster user, I want to rename and delete my own profiles, so that the list stays tidy.
51. As a cluster user, I want a profile I delete to stop applying to the clusters it was assigned to, which then get the default profile, so that no cluster is left without a profile.

### Assigning profiles to clusters

52. As a cluster user, I want to pick a cluster's profile on a Freelens AI tab of the cluster's settings, so that I set it where I manage the cluster.
53. As a cluster user, I want a table of every cluster and its profile in the preferences, so that I can review all assignments in one place.
54. As a cluster user, I want to choose the default profile, so that a cluster I add later is safe before I think about it.
55. As a cluster user, I want a badge in the chat header with the cluster's profile, so that I know what the agent may do before I type.
56. As a cluster user, I want a profile change to apply from the next invocation, so that I do not have to restart the chat.
57. As a cluster user, I want the agent to know the cluster's profile, so that it does not waste turns on invocations that will be denied.

### Showing invocations in the chat

58. As a cluster user, I want each CLI invocation shown as its command line, so that I can follow what the agent does.
59. As a cluster user, I want the manifest and the output of an invocation collapsed with the exit code visible, so that the chat stays readable.
60. As a cluster user, I want a failed invocation marked as failed with its error output, so that I see what went wrong.
61. As a cluster user, I want to see when Freelens is downloading the kubectl that matches my cluster, with progress, so that a first slow invocation does not look stuck.
62. As a cluster user, I want a denied invocation shown with the reason, whether the floor or my profile denied it, so that I know what to change if I want to allow it.

### Upgrading

63. As an existing user, I want my per-tool approval choices carried over into a profile, so that the agent asks me about the same things after the upgrade.
64. As an existing user who never changed an approval setting, I want my clusters on the Standard profile, so that the agent behaves as it did.
65. As an existing user, I want my pod logs tail lines preference to keep applying to logs the agent reads, so that log reads stay as large as I set them.

### Maintainers

66. As a maintainer, I want the policy evaluation to be one pure function shared by main and the settings page, so that the test box and the agent can never disagree.
67. As a maintainer, I want the agent host tested against a stand-in CLI, so that every rule can be tested without a cluster or a kubectl binary.
68. As a maintainer, I want a new kubectl capability to need no new code, so that the agent keeps up with kubectl on its own.

## Implementation Decisions

### The two tools

- The agent's tool list holds exactly `kubectl` and `helm`. The twelve
  cluster tools, the code that resolves kinds to API paths, the per-kind
  manifest schemas and handlers, the field filter, the pod logs helpers, the
  approval preparation per tool name and the approval backups per tool name
  are removed.
- Both tools have the same parameters:
  - `args`: the arguments after the program name, as an array of strings.
  - `manifest` (optional): one or more objects as YAML or JSON. Accepted only
    with verbs that take a manifest (`apply`, `create`, `replace`, `delete`,
    `diff`). The tool adds `-f -` and sends the manifest on standard input.
    `-f` and `--filename` in `args` are always rejected.
  - `grep` (optional): a regular expression; only the output lines that match
    it are kept.
  - `timeoutSeconds` (optional): 30 seconds when unset, at most 300. A
    helm `upgrade`, `rollback` or `uninstall` gets 300 when unset, so that
    helm is not killed in the middle of a change.
  - `revealSecrets` (optional): asks for Secret values unredacted.
- Both tools are `executionMode: "sequential"`. pi then runs every call one at
  a time and asks each approval only after the previous call has finished, so
  a dry-run diff is always computed against the current state (ADR 0003). No
  read or write classification exists anywhere.
- A tool call on a cluster that is not connected is the error result "Cluster
  not connected", and no process starts.
- The tool definitions stay shared with the renderer, which shows them in the
  chat's tool list.

### Running a CLI invocation

- A CLI runner in main runs the binary that `Main.Shell` returns for the
  cluster (`getKubectlPath(clusterId)` or `getHelmPath(clusterId)`), with
  `execFile`, the argument array and the environment of
  `Main.Shell.getEnvironment(clusterId)`. No shell is ever involved. Only the
  manifest is sent on standard input; any other invocation gets none.
- The agent host takes the runner as an option, in place of the cluster
  client option it takes today. Its request carries the cluster id, the
  program, the arguments, the manifest, the timeout, pi's abort signal and a
  progress callback. Its answer is the standard output, the standard error and
  the exit code.
- The kubectl download that `Main.Shell` may start reports its phases and
  progress through the progress callback. The tool forwards them as pi's
  partial tool updates.
- Stop aborts pi's signal, which kills the process. The timeout kills it too.
  A killed process is an error result that says which of the two happened.
- The result for the model holds the exit code, the standard output and, when
  present, the standard error. A non-zero exit code makes it an error result.
- `grep` is applied to the output lines before the cap. The output is capped
  at 256 KiB, keeping its head and tail with a marker that says how much was
  cut.
- `kubectl logs` without `--tail`, `--since` or `--since-time` gets
  `--tail=<the pod logs tail lines preference>`, as the logs tool used to.

### The invocation policy (a pure module in common)

- One pure function takes the program, the arguments, the manifest,
  `revealSecrets`, the policy profile and a resource catalog. It returns
  either a floor rejection with its reason, or the canonical forms, the policy
  level and, for each canonical form, the rule that matched. Main calls it for
  every tool call. The settings page calls it for the test box. It reaches no
  Node, pi or DOM API.
- **Parsing.** The parser knows the global flags of kubectl and helm, which of
  their flags take a value, and the verbs with more than one word
  (`rollout restart`, `auth can-i`, `get values`, `search repo`, ...). It
  accepts every spelling of a flag (`-n prod`, `-nprod`, `--namespace prod`,
  `--namespace=prod`) and `<resource>/<name>`. An argument it cannot place is
  a floor rejection rather than a guess.
- **Resource catalog.** Resource names in the canonical form are the plural
  resource names of the cluster's discovery. Short names, singulars, kinds and
  group-qualified names (`po`, `pod`, `Pod`, `deployments.apps`) all map to
  them. Main builds the catalog from `kubectl api-resources` of the cluster,
  through the same runner. It keeps the catalog for the cluster's session and
  refreshes it when a resource is not found. The test box uses a built-in
  catalog of the Kubernetes kinds.
- **Canonical form.** `<program> <verb> <resource> <name> -n <namespace>`,
  one per target:
  - one per resource and name: `get pods,svc` gives two, `delete pods a b`
    gives two;
  - one per object of the manifest, with its resource, name and namespace
    taken from the object;
  - the name is `*` when the targets come from a label selector, a field
    selector, `--all` or no name at all;
  - the namespace is `*` with `-A` or `--all-namespaces`;
  - a cluster-scoped resource has no namespace;
  - a namespaced resource without `-n` gets the namespace the environment's
    kubeconfig selects, or `default`;
  - `revealSecrets` on a read of Secrets turns the verb into `reveal`;
  - helm's canonical forms use the resource `releases` (and `charts` for
    `show` and `search repo`), with the release name as the name.
- **Floor.** A rejection names the entry that rejected the invocation. The
  floor rejects:
  - flags that change the cluster or the identity: `--kubeconfig`,
    `--context`, `--cluster`, `--server`, `-s`, `--token`, `--user`,
    `--username`, `--password`, `--as`, `--as-group`, `--as-uid`,
    `--certificate-authority`, `--client-certificate`, `--client-key`,
    `--insecure-skip-tls-verify`, `--tls-server-name`, `--cache-dir`, and
    helm's `--kube-*` flags;
  - verbs that reveal credentials or change the configuration: `config`,
    `create token`, `certificate`, helm's `registry login` and `repo add`;
  - access to the user's disk or local code: `-f` or `--filename` in
    `args`, `-k` and `--kustomize`, `cp`, `--from-file` and
    `--from-env-file`, `kustomize`, `plugin`, any verb that is not a kubectl
    or helm verb (kubectl would look for a plugin), helm `install` or
    `upgrade` with a local chart path or a URL, and helm `--post-renderer`;
  - invocations that never end or need a terminal: `proxy`,
    `port-forward`, `attach`, `edit`, `-i`, `--stdin`, `-t`, `--tty`, `-w`,
    `--watch`, `-f` and `--follow` on `logs`, `run -i`;
  - output formats on Secrets that would print values around the
    redaction (`-o jsonpath`, `go-template`, `custom-columns`, `template`)
    unless `revealSecrets` is set;
  - a manifest that does not parse, or a `manifest` with a verb that takes
    none.
- **Rules.** A policy rule is a pattern over the canonical form and a policy
  level:
  - The pattern has the shape of the canonical form. Each part is a literal,
    a glob (`web-*`) or `*`. Omitted trailing parts mean `*`, so
    `kubectl get *` matches every get. A rule without `-n` matches every
    namespace and cluster-scoped resources.
  - A canonical form whose name or namespace is `*` matches only rules whose
    name or namespace is `*` or omitted. A rule `kubectl delete pods web-*`
    does not match a delete by label selector, and a rule scoped to `-n dev`
    does not match `-A`.
  - When several rules match a canonical form, the most specific wins: each
    part counts 2 when literal, 1 when a glob with literal characters, 0
    when `*`. On a tie, the most restrictive level wins (Deny, then Always
    ask, then Ask, then Allow). A canonical form no rule matches gets the
    profile's fallback level.
  - The invocation's level is the most restrictive level among its
    canonical forms.
- **Dry-run verbs.** An internal list names the verbs that accept
  `--dry-run=server`: `apply`, `create`, `replace`, `patch`, `delete`,
  `scale`, `label`, `annotate`, `set`, `rollout restart`, `rollout undo`,
  `cordon`, `uncordon`, `drain`, `taint`, and helm `upgrade` and `rollback`
  (helm's own `--dry-run=server`). It is a fact about the CLIs, not a
  setting.

### The approval gate

- pi's `tool_call` hook runs the invocation policy for every call:
  - a floor rejection or Deny blocks the call with the reason;
  - Allow lets it run;
  - Ask asks the user, unless "Approve all in this chat" is on;
  - Always ask always asks.
- Before asking for an invocation whose verb is on the dry-run list, the gate
  runs the same invocation with `--dry-run=server -o yaml`. For each named
  target it also reads the current object with `get -o yaml`.
  - If the server rejects the dry run (`Error from server (Invalid)`,
    `(Forbidden)`, `(NotFound)`, `(AlreadyExists)`, `(Conflict)`, or an
    admission webhook that denied the request), the call is blocked with the
    server's message and nobody is asked.
  - If the dry run cannot be made (a webhook that does not support dry
    runs, an API without `dryRun`, a connection error, a timeout, an
    internal error, any output not recognized), the card says "Preview
    unavailable" with the reason. It shows the current YAML of the named
    target, when there is one, as the backup.
  - Otherwise the card shows a diff of each target, current against dry
    run, with managed fields left out.
- The dry run and the reads of the gate are also CLI invocations. They go
  through the same runner and pi's signal, and Stop ends them. They are not
  shown in the chat as tool calls.
- Writes at level Allow get no dry run.
- The approval request of the agent protocol changes. It carries the program,
  the arguments, the manifest, the canonical forms, the policy level, the name
  of the profile, and a preview that is either diffs per target or
  "unavailable" with the reason and an optional backup. The tool name,
  title and YAML message of the old request, and its approval target, are
  removed. The snapshot keeps a pending request as today.
- "Approve all in this chat" lets later Ask invocations of the chat run
  without asking. It never covers Always ask. It stays in memory, as today.
- When the cluster's profile changes, or a profile it uses is edited, every
  pending approval of that cluster is checked again. If the new level is
  Deny, the approval is denied with the reason. If it is Allow, the request
  stays pending until the user answers.

### Secret redaction

- A read of Secrets (`get` of the resource `secrets`, alone or with other
  resources) without `revealSecrets` is run with `-o json`, whatever output
  the agent asked for. In the result, `data` and `stringData` have every value
  replaced by its size, and so does the annotation
  `kubectl.kubernetes.io/last-applied-configuration`, which holds a copy of
  the values. The result is then printed as YAML when the agent
  asked for YAML, and as JSON otherwise. Table output (no `-o`, or `-o wide`
  or `-o name`) shows no values and runs as asked.
- `describe` of Secrets prints sizes for most types, but the token of a
  `kubernetes.io/service-account-token` Secret in full, and no redaction
  reaches its output. Without `revealSecrets` the floor rejects a `describe`
  whose targets include `secrets` (the Secret output entry), and its reason
  points the agent to `get secrets`, whose values are redacted, or to
  `revealSecrets`.
- With `revealSecrets`, the canonical form's verb of a `get` or a
  `describe` of Secrets is `reveal`, so a profile decides about reveals with
  rules such as `kubectl reveal secrets *`.
- helm prints rendered Secrets in the output of `get manifest`, and of
  `upgrade` and `rollback` with `--dry-run` (and `status`, `upgrade` and
  `rollback` with `--debug`). The Secret documents of that output have
  `data`, `stringData` and the last-applied-configuration annotation replaced
  by their sizes, as kubectl's redaction does; `helm status -o json` and
  `-o yaml`, which print the release as one object, are rejected by the floor
  without `revealSecrets`. With `revealSecrets`, the canonical form's verb is
  `reveal` (resource `releases`, the release's name; a change keeps its own
  form next to it), the profile decides, and the output is unredacted.
  `helm get values` and `get notes` stay as they are: Helm values are out of
  scope.

### Policy profiles and their storage

- **Shipped profiles.** They live in code, have fixed ids and cannot be
  edited. They are:
  - **Read only**: fallback Deny. Allow for `get`, `describe`, `top`,
    `events`, `explain`, `api-resources`, `api-versions`, `version`,
    `auth can-i`, `diff`, `rollout status`, `rollout history`, and helm
    `list`, `status`, `history`, `get values`, `get manifest`, `get notes`,
    `show`, `search repo`. Ask for `kubectl logs *` and
    `kubectl reveal secrets *`.
  - **Standard** (the initial default profile): the rules of Read only,
    with fallback Ask. Always ask for `kubectl exec *`, `kubectl drain *`,
    `helm uninstall *`, and `kubectl delete` of the cluster-scoped kinds of
    Kubernetes: namespaces, nodes, customresourcedefinitions,
    persistentvolumes, clusterroles, clusterrolebindings, storageclasses,
    priorityclasses, ingressclasses, apiservices,
    mutatingwebhookconfigurations and validatingwebhookconfigurations.
  - **Permissive**: the rules of Standard, with Allow for `kubectl logs *`
    and for the change verbs: `apply`, `create`, `replace`, `patch`,
    `delete`, `scale`, `label`, `annotate`, `set`, `rollout restart`,
    `rollout undo`, `rollout pause`, `rollout resume`, `cordon`,
    `uncordon`, `taint`, and helm `upgrade` and `rollback`. Fallback Ask.
    Reveals stay Ask, and the Always ask rules of Standard stay, because
    they are more specific than the Allow rules.
- **User profiles.** They are stored in `PreferencesStore` with an id, a name,
  their rules (pattern and level) and a fallback level. A new user profile is
  either empty with fallback Ask, or a copy of any profile's rules and
  fallback.
- **Assignments.** `PreferencesStore` stores the assignments from cluster id
  to profile id, and the id of the default profile. A cluster without an
  assignment, or assigned to a profile that no longer exists, uses the default
  profile. A default profile that no longer exists falls back to Standard.
- The new fields are plain observable fields of the annotation map, replaced
  as a whole, and `toJSON()` returns plain values ("Decorators and the
  stores" in AGENTS.md).
- The agent host reads the cluster's profile per call through a new option
  that replaces the approval overrides option: the profile of a cluster id,
  with its name.

### Migration

- At startup, when `toolApprovalOverrides` (or the older
  `podLogsRequireApproval`) holds choices that differ from today's defaults,
  main creates a user profile named "Standard (migrated)". It is a copy of
  Standard with rules translated from those choices, and becomes the default
  profile:
  - `getPodLogs` without approval: `kubectl logs *` Allow;
  - `patchKubernetesResource`: `patch`, `scale`, `set`;
  - `updateKubernetesResource`: `replace`, `apply`;
  - `createKubernetesResource`: `create`, `apply`;
  - `deleteKubernetesResource` and `deletePod`: `delete`;
  - `restartKubernetesResource`: `rollout restart`;
  - each of these without approval translates to Allow for those verbs;
  - a read tool set to need approval translates to Ask for its verb.
- The old field is then written back as `null`, as the old OpenAI fields
  are. A user without such choices gets no new profile and stays on
  Standard.
- `podLogsTailLines` stays and keeps its meaning (see "Running a CLI
  invocation").

### The system prompt

- The `cli_policy` section is set in `before_agent_start`, like `cluster`
  and `user_rules`, before every run. It names the cluster's profile, lists
  its rules and fallback level and summarizes the floor, so that a change
  applies from the next run.
- The system prompt drops "there is no shell" and the guidance for the old
  tools: the log filter, the `resize` and `scale` subresources, patch over
  update. In their place it says that the agent runs kubectl and helm through
  the two tools, only within the floor and the profile, and that it uses
  `grep`, selectors and `-o` to keep output small. The safety rules stay:
  read before changing, one change at a time, the least destructive option,
  and no deletion of namespaces, CRDs or cluster-scoped resources unless
  named.
- AI Explain is unchanged: no tools.

### Renderer

- **Profile editor.** It replaces the per-tool approval list of the
  preferences page:
  - a list of profiles, the shipped ones marked read-only;
  - "New profile" (empty, or a copy of a chosen profile, the copy of
    Standard preselected), "Duplicate", "Rename" and "Delete" (user
    profiles only);
  - for a user profile, its rules as rows of pattern and level, and its
    fallback level;
  - the default profile picker;
  - a table of the clusters Freelens knows with their profile;
  - the floor, read-only, with the reason for each entry;
  - a test box: an invocation typed as a command line shows its canonical
    forms, the matching rule of each and the resulting level, or the floor
    entry that rejects it.
- **Cluster settings tab.** A "Freelens AI" tab registered through
  `entitySettings` for the cluster entity holds a profile picker for that
  cluster. It is wrapped in an error boundary like the other registrations.
- **Badge.** The chat header shows the cluster's profile name.
- **Tool card.** A CLI invocation shows as its command line (`kubectl get
  pods -n web`), its manifest collapsed, its output collapsed with the exit
  code, and the kubectl download progress while it runs. A blocked call
  shows the reason: the floor entry, Deny of the profile, a rejected dry
  run, or the user's denial.
- **Approval card.** It shows the command line, the targets, the profile and
  level, the manifest, and the diffs or "Preview unavailable" with the reason
  and the backup. "Approve all in this chat" is not offered for Always ask.
- **Tool list.** The chat's tool list shows the two tools.

### Documentation

- AGENTS.md: "Cluster tools in the main process" and "Approvals" are
  rewritten for CLI invocations, the floor and policy profiles. The
  test-support list replaces the stand-in cluster client with the stand-in
  CLI and the fake kubectl. "Rules That Fail Silently" gains the rule that
  every invocation goes through the invocation policy, and that `execFile`
  never gets a shell. The README is updated accordingly.
- ADR 0003 records the decision. `GLOSSARY.md` holds the vocabulary.

## Testing Decisions

A good test drives the feature from the outside, through the seams below,
and asserts what a user or the model would see: the invocation that runs, the
envelopes, the tool result, the card. It does not assert on internal
helpers.

- **The agent host, through `handleCommand(clusterId, command)`**: the main
  seam. It drives the host with pi's faux provider and asserts on the
  envelopes, the tool results and what the stand-in CLI recorded. A new
  stand-in CLI in the test support replaces the stand-in cluster client. It
  records every invocation (cluster id, program, arguments, manifest,
  timeout, signal) and answers by invocation with standard output, standard
  error and exit code, or hangs until the signal aborts. Tested here:
  - a floor rejection and Deny never reach the CLI;
  - Allow, Ask and Always ask, with and without "Approve all in this chat";
  - the dry run before an Ask, its diff on the card, a rejected dry run that
    blocks without asking, and "Preview unavailable" with the backup;
  - redacted and revealed Secrets;
  - `grep`, the output cap, the timeout and the error result of a non-zero
    exit code;
  - Stop during an invocation and during an approval;
  - calls run one at a time;
  - a profile change re-checking a pending approval;
  - the `cli_policy` section;
  - "Cluster not connected" without any invocation;
  - the logs tail default.

  Prior art: the existing agent host tests (approval gate, injected fetch,
  snapshot) and the stand-in cluster client they use.
- **The invocation policy**: table-driven tests of the pure function. They
  cover:
  - the spellings of flags, aliases and short names;
  - `<resource>/<name>`, several resources and names, selectors, `--all`
    and `-A`;
  - manifests of several objects;
  - every floor entry;
  - specificity and its ties, the fallback level, and the most restrictive
    of several canonical forms;
  - `reveal`, and helm's canonical forms.

  Prior art: the tests of the existing pure helpers (field filter, pod logs,
  approval settings).
- **The extension entry**: the existing entry test, with the stub's
  `Main.Shell` returning the path of a fake kubectl (a small Node script in
  the test support) and an environment. It proves that the real runner:
  - passes the argument array without a shell, the cluster's environment,
    and the manifest on standard input;
  - kills the process on Stop and on the timeout;
  - caps the output and turns a non-zero exit code into an error result.

  This is the only test that starts a process.
- **Renderer views**: React Testing Library in jsdom, with `console.error`
  spied on as in the existing view tests. They cover:
  - the profile editor: shipped profiles read-only, new, duplicate, rename,
    delete, rule rows, fallback, default, assignments, the test box;
  - the cluster settings tab and its registration;
  - the badge;
  - the tool card and the approval card of an invocation.

  Prior art: the tool call, interrupt and renderer entry tests. The test stub
  of `@freelensapp/extensions` gains `entitySettings` support and a stand-in
  `Main.Shell`.
- **The migration**: tests of the pure function that turns the old overrides
  into a user profile. Prior art: the legacy preferences tests.
- Removed with the old tools: the stand-in cluster client and the tests of
  the read tools, the write tools, the resource paths, the request errors, the
  field filter, the pod logs helpers, the resource handlers, the projection
  and the version summary.

## Out of Scope

- Export and import of profiles.
- Rules per cluster on top of a profile; a variant is a new user profile.
- Assigning profiles by cluster name globs or catalog labels.
- Interactive invocations: `exec -it`, `attach`, `edit`, `port-forward`,
  `proxy`, following logs and watches.
- Helm `install`, `repo add`, local charts and chart URLs.
- Redacting secrets outside Secret objects: Helm values (`helm get values`
  and the values `--debug` prints), environment variables in pod specs,
  ConfigMaps that hold credentials, and output of `exec`.
- Parallel reads.
- Tools for AI Explain.
- Changes to pi: per-call execution modes, a runtime-level `fetch`.

## Further Notes

- **Delivery** in three slices, each usable on its own:
  1. The `kubectl` tool with the floor, the invocation policy, the shipped
     profiles and the default profile, the redaction, the dry-run approval
     card, the tool card, the `cli_policy` section and the migration. The
     twelve tools are removed, and every cluster uses the default profile.
  2. User profiles and the profile editor, the assignment per cluster (the
     cluster settings tab and the preferences table), the default profile
     picker and the badge.
  3. The `helm` tool.
- Choosing the parts of slice 1 that need no user profiles keeps it
  shippable. Before slice 2, the migration's "Standard (migrated)" profile
  exists in the store and is the default profile, but cannot be edited yet.
- The tail lines default for `kubectl logs`, the `releases` and `charts`
  resources of helm's canonical forms, the specificity weights and the
  resolution of a missing namespace were settled while writing this spec, as
  the most direct reading of the decisions taken in the session.
- Functional checks run against Freelens dev ("Checking the Extension in
  Freelens Dev" in AGENTS.md), on `kind-kind` with Flux. That covers the
  download of a version-matched kubectl, an admission webhook without dry-run
  support, and a cluster that disconnects during an invocation.
