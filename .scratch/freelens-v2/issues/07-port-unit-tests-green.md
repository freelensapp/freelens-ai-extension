# 07: Port, step 5: unit tests on Vitest 5, tree green again

**What to build:** the end of the integration chain. Every check passes again
and the branch is pushed.

The tests run on the `main` branch's Vitest setup, with its stub of
`@freelensapp/extensions`. The existing tests (agent host with pi's faux
provider, provider service, credentials import, custom endpoints, system
prompt, chat reducer, cluster tools, the pure tool helpers, the settings UI
helpers) pass, changed only where the v2 API or the toolchain requires it.

A new extension entry test drives the main-process extension class against
the stub: activating, deactivating and activating again leaves exactly one
handler per IPC channel and one agent host, and deactivating during a run
stops it without errors.

Tests import what they use from `vitest`, are type-checked in their own
program, and `vitest` imports are banned outside test code, as on the `main`
branch.

**Blocked by:** 06 (port, step 4).

**Status:** ready-for-agent

- [ ] Install, type check, Biome, unit tests, build and the checks of the
      built output all pass.
- [ ] The extension entry test covers activate, deactivate, activate and
      deactivate during a run.
- [ ] No existing test was deleted to get green; any test removed is listed in
      the report with the reason.
- [ ] One commit; the commits of tickets 03 to 07 are pushed.
