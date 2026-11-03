# 06: Profiles in the store

**What to build:** the policy profile of each cluster comes from the
preferences, no longer from a hard-wired Standard. The store holds the user
profiles, the assignments from cluster to profile, and the default profile. A
change to any of them reaches the agent at the next invocation and re-checks
pending approvals. Existing per-tool approval choices are carried over into a
user profile. There is no UI yet (tickets 08 and 10); tests change the store.

See the spec, "Policy profiles and their storage" and "Migration".

**Blocked by:** 03

**Status:** resolved (HITL check pending: manual-test-cases.md)

- [x] `PreferencesStore` gains user profiles (id, name, rules of pattern and
      level, fallback level), the assignments from cluster id to profile id,
      and the default profile id. They are plain observable fields of the
      annotation map, replaced as a whole, and `toJSON()` returns plain
      values.
- [x] The agent host reads the cluster's profile per call through an option
      that replaces the approval overrides option. A cluster without an
      assignment, or assigned to a missing profile, gets the default profile.
      A missing default profile falls back to Standard.
- [x] A change to an assignment, to the default, or to a profile a cluster
      uses re-checks the pending approvals of the affected clusters. Deny
      denies the approval with the reason, and any other level leaves it
      pending.
- [x] At startup, choices in `toolApprovalOverrides` or `podLogsRequireApproval`
      that differ from today's defaults become a user profile "Standard
      (migrated)". It is a copy of Standard with the translated rules and
      becomes the default profile. The old field is then written back as
      `null`. A user without such choices stays on Standard and gets no new
      profile.
- [x] Tests cover the migration as a pure function, and agent host tests
      cover an assignment, the default, a missing profile and the re-check of a
      pending approval.

## Comments

Built on `cli/06`. Decisions taken while building it, approved by the
supervisor:

1. **The host option.** `getPolicyProfile(clusterId)` and
   `getApprovalOverrides` are replaced by `getPolicyProfileSettings()`, which
   returns `PolicyProfileSettings` (`userProfiles`, `profileAssignments`,
   `defaultProfileId`); main passes the store itself. The host resolves the
   cluster's profile with `clusterPolicyProfile` of
   `src/common/invocation-policy/profile-assignment.ts`, which the renderer can
   use too: the assigned profile, else the default profile, else Standard. A
   shipped id wins over a user profile with the same id, and the store drops
   such a user profile when it loads.
2. **The store fields** `userProfiles: PolicyProfile[]`,
   `profileAssignments: Record<string, string>` (cluster id to profile id) and
   `defaultProfileId: string` (`"standard"` by default) are `observableRef` /
   `observable` fields of the annotation map, loaded by `loadUserProfiles`,
   `loadProfileAssignments` and `loadDefaultProfileId`
   (`src/common/store/policy-profile-preferences.ts`), which leave out what is
   not whole.
3. **The migration** (`migrateApprovalChoices` of
   `src/common/store/approval-migration.ts`) carries its own table of the old
   tools' defaults and verbs, so ticket 07 can remove the tool definitions.
   `deletePod` without approval becomes `kubectl delete pods *` Allow, not
   `kubectl delete *`. The read tools set to need approval become Ask rules:
   `getClusterVersion` `kubectl version`, `getNamespaces`
   `kubectl get namespaces *`, `getWarningEventsByNamespace`
   `kubectl get events *` and `kubectl events *`, `listKubernetesResources`
   and `getKubernetesResource` `kubectl get *`. A translated rule replaces the
   rule of Standard with the same pattern rather than adding a second one. The
   profile has the fixed id `standard-migrated`, so it is never added twice.
   `toolApprovalOverrides` is now a legacy field; main migrates it and clears
   it and `podLogsRequireApproval` (`clearLegacy(APPROVAL_CHOICE_KEYS)`) at
   activation, before the imports of pi clear every old field.
4. **The old tools until ticket 07** gate by their `requiresApprovalByDefault`
   only. A user who had turned approval off for an old write tool (or for pod
   logs) is asked again by that tool until ticket 07 removes it. That is
   temporary, and on the safe side. `approval-settings.ts` is removed with its
   last user.
5. **The per-tool approval list** is removed from the preferences page here,
   since nothing reads or writes the field any more (ticket 08's criterion).
6. **The re-check.** `AgentHost#recheckPendingApprovals()` evaluates every
   pending kubectl approval again with the profile of its cluster as it is
   now, the agent's own arguments and the resources the call was evaluated
   with (kept on the pending approval as a closure, not on the protocol). Deny,
   or a floor rejection, settles it denied with the reason, which the model
   gets as the tool result; any other level leaves the card as it is. Main
   calls it from a mobx `reaction` on the three store fields, disposed in
   `onDeactivate`; the fields are replaced as a whole, so an edit of a
   profile's rules or fallback level fires it too.

Decisions of the final fix pass, taken by the supervisor after the review of
the integration branch:

7. **A re-check that leaves an approval pending** (the open risk of item 6).
   When the level or the profile's name changed, the pending request is
   replaced with the new level and name and sent to the frames again as a
   `ui_request` with the same id; the frame's reducer updates the card while
   it is unanswered, so a card moved from Ask to Always ask shows Always ask
   and stops offering "Approve all in this chat", and the answer is gated on
   the request's current level. A level of Allow shows as Ask: the user still
   answers it. Nothing is sent when neither changed.
8. **A profile change during the dry run.** The gate evaluates the call again
   with the cluster's profile right before it registers and sends the
   request, so a profile switched while the dry run ran applies: Deny or the
   floor blocks the call without a card, and the card shows the level and the
   name of the profile as they are then.

Manual check in Freelens dev, still to run: install the checkout in place on
`kind-kind`, connect a provider and choose a model.

- Before installing, in the preferences file of an older build, have
  `toolApprovalOverrides: { "getPodLogs": false }`: after the start, the file
  holds a user profile "Standard (migrated)" with `kubectl logs *` Allow,
  `defaultProfileId: "standard-migrated"` and `toolApprovalOverrides: null`;
  "show the logs of a flux-system pod" runs `kubectl logs` without a card.
- Ask "scale the deployment podinfo to 2": while the card is pending, set
  `profileAssignments` of the cluster to `read-only` (through DevTools of the
  root frame on the store, until ticket 10 adds the picker): the card goes
  away and the tool card shows "Denied by the policy profile "Read only": ...".
- No error in DevTools of either frame, and none of the `freelens-ai` scope in
  main's log.
