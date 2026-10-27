# 02: Common code is process-neutral

**What to build:** a prefactor on the current toolchain, so that the v2
TypeScript layout (ticket 05) passes its environment tests the first time.
Code shared by both processes must not depend on either one. Today two common
modules do:

- the logger service imports React, which does not exist in the main process;
- the preferences store imports the chat message object type from the
  renderer.

The React-based logger moves to the renderer, the main process gets a plain
logger with the same calls, and the chat message object types the store needs
move into common. The behaviour does not change.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] No module in common imports React, a renderer module or a main-process
      module.
- [ ] The main process logs through a logger that needs neither React nor the
      DOM; the renderer keeps its current logging.
- [ ] The saved preferences (including the chat messages the store keeps) read
      and write the same values as before; the existing store tests pass.
- [ ] Type check, Biome, unit tests and the build pass on the current
      toolchain.
- [ ] One commit.
