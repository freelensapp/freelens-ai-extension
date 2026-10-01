# Spike: pi-coding-agent in Freelens main

Type: task
Status: open
Blocked by:

## Question

Can `@earendil-works/pi-coding-agent` (and the `pi-agent-core` / `pi-ai` it
pulls in) run inside the extension's main process and stream one completion?

Facts the decisions downstream wait on:

- Does it bundle into `out/main` (CJS, rolldown via electron-vite), or does it
  have to stay an external ESM dependency loaded with dynamic `import()`?
  Check `import.meta.url`, variable-specifier `import()` and JSON import
  attributes (`docs/PI_AGENT_SDK_RESEARCH.md`, Q1).
- Does it run on the Node/Electron version Freelens >= 1.8.0 ships
  (`engines.node >= 22.19.0`)?
- Does `pnpm pack:dev` produce a `.tgz` that installs and activates in
  Freelens with it?
- Size impact on the packed extension.

Keep the spike on a `prototype/pi-agent` branch and link it here. Record what
was done and the resulting facts under Answer. AFK where possible; installing in
a real Freelens is HITL.
