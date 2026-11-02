# 06: Profiles in the store

**What to build:** the policy profile of each cluster comes from the
preferences, no longer from a hard-wired Standard. The store holds the user
profiles, the assignments from cluster to profile, and the default profile. A
change to any of them reaches the agent at the next invocation and re-checks
pending approvals. Existing per-tool approval choices are carried over into a
user profile. There is no UI yet (tickets 08 and 10); tests change the store.

See the spec, "Policy profiles and their storage" and "Migration".

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `PreferencesStore` gains user profiles (id, name, rules of pattern and
      level, fallback level), the assignments from cluster id to profile id,
      and the default profile id. They are plain observable fields of the
      annotation map, replaced as a whole, and `toJSON()` returns plain
      values.
- [ ] The agent host reads the cluster's profile per call through an option
      that replaces the approval overrides option. A cluster without an
      assignment, or assigned to a missing profile, gets the default profile.
      A missing default profile falls back to Standard.
- [ ] A change to an assignment, to the default, or to a profile a cluster
      uses re-checks the pending approvals of the affected clusters. Deny
      denies the approval with the reason, and any other level leaves it
      pending.
- [ ] At startup, choices in `toolApprovalOverrides` or `podLogsRequireApproval`
      that differ from today's defaults become a user profile "Standard
      (migrated)". It is a copy of Standard with the translated rules and
      becomes the default profile. The old field is then written back as
      `null`. A user without such choices stays on Standard and gets no new
      profile.
- [ ] Tests cover the migration as a pure function, and agent host tests
      cover an assignment, the default, a missing profile and the re-check of a
      pending approval.
