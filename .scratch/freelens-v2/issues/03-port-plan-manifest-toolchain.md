# 03: Port, steps 0 and 1: plan record, manifest and toolchain

**What to build:** the start of the port. Freelens 2 accepts the extension at
discovery, and the repository installs with the `main` branch's toolchain.

Step 0 writes the plan record next to the spec: the inventory of every v1 API
the pi agent branch uses with its v2 replacement (the `api.md` C1 to C15
checklist applied to this code), the decisions of the spec, the step checklist
of the tickets, the functional checks and a findings section. The spec, the
ADRs and the tickets are already committed.

Step 1 sets the manifest and the dependencies:

- `@freelensapp/extensions` pinned exactly to the nightly the `main` branch
  uses;
- `engines.freelens ^2.0.0`, `engines.node >= 24`, `"type": "module"`, version
  `1.0.0-0`, entries and `files` on `dist/`;
- the `main` branch's versions of React, mobx, mobx-react, TypeScript, Vite,
  Vitest, Sass, the Electron types and esbuild, with the host-provided
  libraries as development dependencies only;
- pnpm 12 with strict peer dependencies, and the `main` branch's package
  manager settings;
- pi stays at 1.4.0 and stays bundled;
- electron-vite, the global externals, the legacy decorator plugins and the
  Sass declaration plugin go.

This ticket opens the integration chain of tickets 03 to 07: the tree is not
expected to type-check, build or test until ticket 07, and commits stay local
until then.

**Blocked by:** 01 (pi 1.4.0 on the current toolchain).

**Status:** resolved

- [x] The plan record exists and lists every v1 API use with its v2
      replacement, including the removed `openExternal` and the host channel
      used to open the preferences.
- [x] The manifest has the engines, module type, version, entries and files
      above, and the host API is pinned to the same nightly as the `main`
      branch.
- [x] Dependency versions match the `main` branch wherever both branches use
      the package.
- [x] `pnpm install` succeeds with strict peer dependencies.
- [x] The step report says which checks fail and why (expected until ticket
      07).
- [x] Two commits: step 0 and step 1.
