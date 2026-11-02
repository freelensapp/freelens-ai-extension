# 05: Secret redaction and reveal

**What to build:** Secret values stay hidden from the model. A read of Secrets
comes back with keys, type and value sizes only. Revealing values is a
separate action that the cluster's policy profile decides, Ask in every
shipped profile.

See the spec, "Secret redaction".

**Blocked by:** 03

**Status:** ready-for-agent

- [x] A `get` that includes the resource `secrets`, without `revealSecrets`,
      runs with `-o json` whatever output was asked for. In the result, every
      value of `data` and `stringData` is replaced by its size, and the result
      is printed as YAML when YAML was asked for, as JSON otherwise.
- [x] Table output (no `-o`, `-o wide`, `-o name`) runs as asked.
- [x] With `revealSecrets`, the canonical form's verb is `reveal`. The
      profile decides it, and the card says that values will be revealed.
      The result is unredacted.
- [x] Value-printing formats on Secrets without `revealSecrets` are rejected
      by the floor with their reason.
- [x] Agent host tests cover a redacted single Secret, a redacted list mixed
      with other resources, YAML and JSON output, table output, a reveal that
      asks, and a reveal denied by the user.

## Comments

The floor's handling of object-printing writes on Secrets and of verbose logging is decided in ticket 02, Comments, items 1 and 2.

Built on `cli/05`. The redaction is `tools/secret-redaction.ts` in main; the
gate plans it from the policy's targets, and the kubectl tool runs and prints
by that plan.

Decisions taken while building it:

1. **The annotation of client-side apply.** On every Secret of a redacted
   result, the value of `kubectl.kubernetes.io/last-applied-configuration`,
   a copy of the whole manifest with its values, is replaced by its size too
   (approved by the supervisor; the spec says so now). Every other annotation,
   the labels and `managedFields`, whose `fieldsV1` holds the keys only, stay.
2. **Which objects.** Only objects of kind `Secret` are redacted, at the top
   or among the items of a List; the ConfigMaps of `get secrets,configmaps`
   keep their data.
3. **How a value reads.** `redacted, 8 bytes`: the decoded size of a `data`
   value, the UTF-8 size of a `stringData` value and of the annotation. The
   result carries a line that says the values are redacted and that
   `revealSecrets` reads them.
4. **The arguments that run.** Every token that sets only the output format
   (`-o yaml`, `-oyaml`, `--output=yaml`, `--output yaml`) is dropped and
   `-o json` added at the end, so the tool card shows the command line that
   ran. A grouped token such as `-Ao yaml` stays, and the `-o json` after it
   wins, as the last value of a flag does in kubectl. The parser now reports
   where each flag token sits (`flagArgs` of `KubectlInvocation`).
5. **Formats.** `yaml` and `kyaml` print YAML, every other format JSON; no
   `-o`, `-o wide`, `-o name` and an empty `-o` run as asked.
6. **An output that is not JSON** is withheld with a line that says why,
   rather than passed on, since its values could not be found. An empty one
   stays empty, so the standard error of a failed get reads as before.
7. **grep** applies to the redacted output, so a `grep` over a Secret's keys
   sees only sizes.
8. **A call runs only after the gate.** The gate keeps, per tool call id on
   the chat's `ClusterAgent` (`passedKubectlCalls`), what it decided about
   each call it lets through, the redaction included; the tool's `execute`
   takes it, and a call the gate did not let through fails with "The
   invocation policy has not checked this call." rather than running
   unredacted.
9. **The card of a reveal** says "Reveal: the values of these Secrets will be
   sent to the model unredacted." whenever a target's verb is `reveal`,
   including the extra reveal forms of writes that print Secrets (ticket 02,
   Comments, item 1).

Decision of the final fix pass, taken by the supervisor after the review of
the integration branch:

10. **describe of Secrets.** kubectl's `describe` of a
    `kubernetes.io/service-account-token` Secret prints its token in full, so
    "`describe` of a Secret prints sizes only" was wrong. A `describe` whose
    targets include `secrets` (by name, `TYPE/NAME`, several resources or a
    category) is treated like the value-printing cases of ticket 02,
    Comments, item 1: without `revealSecrets` the floor rejects it under
    `secret-output`, with a reason that points the agent to `get secrets`,
    whose values are redacted, or to `revealSecrets`; with `revealSecrets`
    its Secret forms have the verb `reveal`, as a get's do, and the profile
    decides. The spec's "Secret redaction" section says so now.

Manual check in Freelens dev, still to run, on `kind-kind` under Standard:

- `kubectl create secret generic db -n default --from-literal=password=hunter22`,
  then `kubectl apply` a Secret manifest, by hand;
- "show the db secret as yaml": `kubectl get secrets db -n default -o json`
  runs without a card, and the answer gives the keys, the type and
  "redacted, 8 bytes", never the value; the same for the applied Secret, whose
  last-applied annotation shows its size only;
- "list the secrets in default": the table, as kubectl prints it;
- "what is the db password?" (the agent sets revealSecrets): a card with the
  target `kubectl reveal secrets db -n default` and the reveal line; deny it,
  and the tool card shows "The user denied the action"; ask again and approve,
  and the value comes back;
- no error in DevTools of the cluster frame, and none of the `freelens-ai`
  scope in main's log.
