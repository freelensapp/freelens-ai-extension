# 08: The profile editor

**What to build:** the user manages policy profiles in the extension's
preferences. Shipped profiles are shown read-only. The user creates,
duplicates, renames and deletes their own profiles, edits every rule and the
fallback level, and chooses the default profile. The editor replaces the
per-tool approval list.

See the spec, "Renderer" (profile editor).

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] The preferences list the shipped and user profiles; the shipped ones
      are marked read-only and cannot be edited.
- [ ] "New profile" creates an empty profile with fallback Ask or a copy of a
      chosen profile, with the copy of Standard preselected. "Duplicate",
      "Rename" and "Delete" work on user profiles. Deleting a profile moves
      its clusters to the default profile.
- [ ] A user profile shows its rules as rows of pattern and level, which can
      be added, edited and removed, and its fallback level.
- [ ] A default profile picker sets the default profile.
- [ ] The per-tool approval list is gone from the preferences.
- [ ] View tests in jsdom cover each of the above, with no `console.error`.
