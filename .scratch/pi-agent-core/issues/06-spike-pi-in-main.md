# Spike: pi-coding-agent in Freelens main

Type: task
Status: resolved
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

## Answer

**Yes. pi-coding-agent 1.0.0 bundles into our CJS main output and runs under
the Electron that Freelens 1.8 ships.**

The spike lives in [`spike/`](../spike/) on `piagent` rather than on a
`prototype/pi-agent` branch, because the automation can only push to the PR
branch. It is not wired into `src/main`.

- `spike/pi-spike.ts` creates an `AgentSession` with:
  - a `ModelRuntime` using its own `auth.json` and `models.json` paths
  - pi-ai's faux provider, so no API key is needed
  - a `DefaultResourceLoader` with all discovery off (`noExtensions`,
    `noSkills`, and so on) and one inline extension factory
  - two custom tools: `cluster_version`, and `delete_pod`, which needs approval
  - a `tool_call` handler that awaits, then blocks `delete_pod`. This stands
    in for the IPC approval round-trip.
  - `noTools: "builtin"`, so pi's file and bash tools are not loaded
  - a file-backed `SessionManager.create(cwd, sessionDir)`
- `spike/vite.spike.config.mjs` uses the same CJS lib, rolldown externals and
  `preserveModules` switch as the `main` section of `electron.vite.config.js`.
- Build:
  `cd .scratch/pi-agent-core/spike && VITE_PRESERVE_MODULES=false pnpm exec vite build -c vite.spike.config.mjs`.
  Then run `node out/pi-spike.js`, or the same file under Electron with
  `ELECTRON_RUN_AS_NODE=1`.

Facts:

- **Bundling.** Everything is bundled. The output only `require`s Node
  built-ins, and it ran with the repo's `node_modules` moved away and the
  output copied to `/tmp`.
  - rolldown rewrites `import.meta.url` correctly.
  - It warns once (`EMPTY_IMPORT_META`), about `import.meta.resolve` in
    `pi-coding-agent/dist/core/extensions/loader.js:51`. That line is only
    reached when **file-based** pi extensions are loaded through jiti, which
    also does `require.resolve("typebox")` at runtime. Inline extension
    factories, which we use, are not affected. See "Not yet specified" on the
    map.
- **Runtime.** Run under Electron 39.8.10 (Node 22.22.1), which is what
  Freelens 1.8.0 depends on (`electron ^39.2.7`; 1.10.0 uses `^41.7.2`). Also
  run under Node 24.15. Results:
  - One prompt ran 3 turns and 2 tool executions.
  - The `tool_call` hook awaited and blocked the second call, and the model
    saw the reason.
  - The final text streamed as `text_delta`s.
  - A JSONL session file of 10 entries was written.
  - Events seen: `agent_start`, `turn_start/end`,
    `message_start/update/end`, `tool_execution_start/end`, `agent_end` and
    `agent_settled`.
- **Real provider path.** With `PI_SPIKE_OPENAI=1` and a fake key, the bundled
  OpenAI provider loaded and reached `api.openai.com`, which returned
  `401 invalid_api_key` as `errorMessage` on the assistant message. A real key
  was not available on the runner, so there was no real completion.
- **OAuth from the bundle.** `ModelRuntime.login()` loads each OAuth flow
  through a variable-specifier `import()`
  (`pi-ai/dist/auth/oauth/load.js`). From our bundle that fails with
  `ERR_MODULE_NOT_FOUND .../anthropic.js`. The fix is to call
  `registerBunOAuthFlows()` from `@earendil-works/pi-ai/bun-oauth` once at
  startup: it registers the flows as static imports. After that, the Anthropic
  and GitHub Copilot logins started and asked their first questions (a
  `select` for the method, and a `text` for the GHE domain). No account was
  used, so neither login was finished.
- **Size.**
  - Production build (`VITE_PRESERVE_MODULES=false`): 47 files, 13 MB
    unpacked, about 2.6 MB gzipped, without source maps.
  - The published `@freelensapp/ai-extension` today is 11 MB unpacked, with
    LangChain. Removing LangChain should offset most of the growth.
  - Large chunks: the jiti static loader (1.9 MB, only used for file-based
    extensions), google-shared (1.4 MB) and the openai SDK (0.7 MB).
  - With `preserveModules`, which the dev build uses, the output is 2067 files
    and 21 MB, and typebox prints Node "circular dependency" warnings at load.
    These are harmless, but noisy in the dev console.
- **Dependencies.** `@earendil-works/pi-coding-agent@1.0.0` and
  `@earendil-works/pi-ai@1.0.0` are added as devDependencies. They are bundled,
  like the rest. `pnpm build` and `pnpm test:unit` still pass, with the
  LangChain core untouched.
- **Not done (HITL):** `pnpm pack:dev` with pi wired into `src/main`, then
  installing the `.tgz` in a real Freelens and streaming a real completion.
  This is best done with the first tracer-bullet ticket, because the spike is
  not wired into `src/main`.
