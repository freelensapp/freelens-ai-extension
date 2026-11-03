# 08: The profile editor

**What to build:** the user manages policy profiles in the extension's
preferences. Shipped profiles are shown read-only. The user creates,
duplicates, renames and deletes their own profiles, edits every rule and the
fallback level, and chooses the default profile. The editor replaces the
per-tool approval list.

See the spec, "Renderer" (profile editor).

**Blocked by:** 06

**Status:** resolved (HITL check pending: manual-test-cases.md)

- [x] The preferences list the shipped and user profiles; the shipped ones
      are marked read-only and cannot be edited.
- [x] "New profile" creates an empty profile with fallback Ask or a copy of a
      chosen profile, with the copy of Standard preselected. "Duplicate",
      "Rename" and "Delete" work on user profiles. Deleting a profile moves
      its clusters to the default profile.
- [x] A user profile shows its rules as rows of pattern and level, which can
      be added, edited and removed, and its fallback level.
- [x] A default profile picker sets the default profile.
- [x] The per-tool approval list is gone from the preferences.
- [x] View tests in jsdom cover each of the above, with no `console.error`.

## Comments

- Ticket 06 removed the per-tool approval list from the preferences page,
  together with `toolApprovalOverrides` and `approval-settings.ts`: the old
  choices are migrated into "Standard (migrated)" and nothing reads the field
  any more.
- The editor is the "Policy profiles" section of the preferences page, between
  "Agent rules" and "Chats", in `src/renderer/pages/preferences/policy-profiles/`:
  `PolicyProfileSettings` (the section: "New profile", the default profile
  picker, the list of profiles and the profile chosen in it), `NewProfileForm`,
  `ProfileDetails` (name, Duplicate, Rename, Delete, fallback level) and
  `ProfileRules` (the rows of command pattern and policy level). Every write
  goes through `policy-profile-edits.ts`, which replaces the fields as a whole
  in a MobX action. The tests are `policy-profile-settings.test.tsx`.
- Decisions taken while building it:
  - "Duplicate" is offered on shipped profiles too, as `GLOSSARY.md` says a
    shipped profile is duplicated to make a variant; Rename and Delete are
    offered on user profiles only. A copy is named `"Copy of <name>"`.
  - A new profile's name is optional: left empty, it is `"Copy of <name>"` or,
    for an empty profile, "New profile".
  - Deleting a profile asks with `window.confirm`, as removing a custom
    endpoint does, and removes the assignments to it, so its clusters get the
    default profile. Deleting the default profile makes Standard the default
    profile, which is what the lookup falls back to anyway, so the picker shows
    the profile that applies.
  - A rule's pattern is saved when its field loses focus, like the agent rules,
    since every save makes main check the pending approvals again; a new rule
    is added only once its pattern is filled in. A pattern is not validated:
    one that does not have the shape of a canonical form matches nothing. The
    test box of ticket 09 is where the user sees that.
- Manual check in Freelens dev (not run; Freelens dev was not running): open
  Preferences > Freelens AI Settings and find "Policy profiles".
  1. The list shows Read only, Standard and Permissive tagged "Shipped",
     Standard also "Default". Choosing one shows its rules and fallback level
     as text, the "cannot be changed" line, and only "Duplicate".
  2. Click "New profile": "Start from" shows "Copy of Standard"; type a name
     and click "Create profile". The new profile is chosen in the list, with
     Standard's rules as editable rows.
  3. Change a rule's pattern, click elsewhere, change its level, remove a row,
     add `kubectl scale * -n dev` as Allow, and set the fallback level to Deny.
     Restart Freelens: the changes are still there.
  4. Rename the profile, duplicate it, and delete the copy (confirm the
     question).
  5. Pick the new profile in "Default profile": it gets the "Default" tag.
     In a `kind-kind` chat, ask the agent to scale a Deployment in `dev`: it
     runs without asking. Delete the profile: Standard is the default profile
     again and the same request asks for approval.
  6. Check both the light and the dark theme, and that DevTools of the root
     frame show no error.
