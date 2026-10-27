# 05: Port, step 3: TypeScript layout and environment tests

**What to build:** the v2 TypeScript layout from the `main` branch. A base
config with the Freelens compiler options; one program each for main, renderer
and common; one for tests; one for tooling files; and the environment tests,
which prove the split with expected errors: Node rejected in renderer and
common code, the DOM rejected in main and common code.

The IPC protocol in common keeps pi's shapes. If pi's declarations pull Node
types into the renderer or common program and the environment tests catch it,
the protocol declares the shapes it needs itself instead of importing them
from pi, and the plan record notes it as a finding for pi.

**Blocked by:** 02 (common code is process-neutral), 04 (port, step 2).

**Status:** ready-for-agent

- [ ] The tsconfig files and environment tests match the `main` branch.
- [ ] The environment tests pass: each expected error is reported, and no
      program sees the other process's globals.
- [ ] Common code type-checks without Node and without the DOM.
- [ ] The step report lists the type errors left for ticket 06.
- [ ] One commit.
