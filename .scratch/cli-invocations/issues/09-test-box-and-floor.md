# 09: The test box and the floor in the preferences

**What to build:** in the profile editor, the user types an invocation as a
command line and sees how the selected profile treats it: its canonical forms,
the rule that matched each, and the resulting level, or the floor entry that
rejects it. The floor is listed read-only with the reason for each entry.

See the spec, "Renderer" (profile editor).

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] The test box splits the command line into arguments, calls the same
      invocation policy as main with the built-in resource catalog, and shows
      the canonical forms, the matching rule of each, and the level, or the
      floor entry and its reason.
- [ ] The floor is listed read-only with the reason for each entry, from the
      same definitions the policy uses.
- [ ] View tests in jsdom cover an Allow, an Ask from a specific rule over a
      broad one, a fallback, a multi-target invocation and a floor rejection.
