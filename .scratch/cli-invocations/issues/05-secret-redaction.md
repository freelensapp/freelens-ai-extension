# 05: Secret redaction and reveal

**What to build:** Secret values stay hidden from the model. A read of Secrets
comes back with keys, type and value sizes only. Revealing values is a
separate action that the cluster's policy profile decides, Ask in every
shipped profile.

See the spec, "Secret redaction".

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] A `get` that includes the resource `secrets`, without `revealSecrets`,
      runs with `-o json` whatever output was asked for. In the result, every
      value of `data` and `stringData` is replaced by its size, and the result
      is printed as YAML when YAML was asked for, as JSON otherwise.
- [ ] Table output (no `-o`, `-o wide`, `-o name`) runs as asked.
- [ ] With `revealSecrets`, the canonical form's verb is `reveal`. The
      profile decides it, and the card says that values will be revealed.
      The result is unredacted.
- [ ] Value-printing formats on Secrets without `revealSecrets` are rejected
      by the floor with their reason.
- [ ] Agent host tests cover a redacted single Secret, a redacted list mixed
      with other resources, YAML and JSON output, table output, a reveal that
      asks, and a reveal denied by the user.

## Comments

The floor's handling of object-printing writes on Secrets and of verbose logging is decided in ticket 02, Comments, items 1 and 2.
