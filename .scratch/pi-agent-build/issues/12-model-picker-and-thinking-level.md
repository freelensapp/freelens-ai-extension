# 12: The chat model picker and the thinking level

**What to build:** the model picker in the chat lists `getAvailable()` models
from the connected providers, grouped by provider, and remembers the last one
used. The settings page gets one global thinking level (`off`, `minimal`,
`low`, `medium`, `high`, `xhigh`; default `medium`) that pi clamps per model.
It replaces the reasoning-effort select and the "Disable thinking mode"
switch.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] The picker shows only models of providers with working auth, grouped by
      provider, and updates after a login or logout.
- [ ] The chosen model applies from the next prompt (pi's `set_model`) and is
      remembered as the last used across restarts.
- [ ] With no connected provider, the chat explains how to connect one and
      links to the settings page.
- [ ] The thinking level is a global preference read by main on each prompt.
- [ ] Agent host tests cover switching the model between prompts and the
      thinking level reaching the session.
- [ ] HITL: switch between two providers' models in one chat.
