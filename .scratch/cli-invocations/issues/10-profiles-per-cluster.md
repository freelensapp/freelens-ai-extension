# 10: Profiles assigned per cluster

**What to build:** the user picks each cluster's policy profile in the
cluster's own settings and sees every assignment in a table in the
preferences. The chat header shows the cluster's profile, so the user knows
what the agent may do before typing.

See the spec, "Renderer" (cluster settings tab, badge, assignment table).

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A "Freelens AI" tab registered through `entitySettings` for the cluster
      entity holds a profile picker for that cluster, wrapped in an error
      boundary like the other registrations.
- [ ] The preferences show a table of the clusters Freelens knows with their
      profile, editable there too.
- [ ] The chat header shows a badge with the cluster's profile name, which
      follows a change at once.
- [ ] The test stub of `@freelensapp/extensions` supports `entitySettings`.
      View tests in jsdom cover the tab, its registration, the table and the
      badge.
- [ ] Checked in Freelens dev: switching `kind-kind` to Read only shows the
      badge, and a `scale` the agent then attempts is denied with the reason.
