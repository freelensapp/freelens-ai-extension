# Plan record: the pi agent on the Freelens v2 extension API

The working record of the port that `spec.md` describes: the inventory of the
v1 constructs with their v2 replacements, the decisions, the steps with their
tickets, the checks and the findings. The tickets are in `issues/`, the ADRs in
`docs/adr/`.

## Source of truth

- Pin: freelensapp/freelens@5e1870e97 and
  `@freelensapp/extensions@2.0.0-0-nightly-2026-10-15`, the nightly the `main`
  branch uses. Its declaration has everything the port needs:
  `Main.Util.fetch` typed as the standard `fetch`, `K8sApi.KubeJsonApi.forCluster`
  in both processes, `LensRendererExtension#navigateToPreferences()`,
  `Renderer.K8sApi.menuItemFor` and `Main.Shell`. Moving to a newer nightly is
  out of scope.
- The Freelens documents at the pin: `docs/extensions/migrating-from-v1.md`
  (the porting guide and its checklist) and `docs/extensions/api.md` (the
  contracts C1 to C15).
- The `main` branch's own v2 port (freelensapp/freelens-ai-extension#292, #298,
  #306) is the reference for the build, tsconfig, environment-test, Vitest,
  Biome, Knip, Renovate, mise, metafile and workflow files, which are copied as
  they are. Its LangChain agents, its HTTP/SSE bridge and its MCP code are not.
- The `port-freelens-extension-to-v2` skill of
  freelensapp/freelens-example-extension gives the steps 0 to 7 and the checks
  of the built output.

## Inventory (step 0)

v1 constructs of the pi agent branch at c4c2d127b (`piagent` with tickets 01
and 02), each with its v2 replacement and the ticket that does it.

| Area | Where | v1 construct | v2 replacement | Ticket |
| --- | --- | --- | --- | --- |
| Manifest | `package.json` | `engines.freelens: ^1.4.0`, `engines.node: >= 22.19.0`, no `type`, version 0.7.1, `main`/`renderer` CJS in `out/main/index.js` and `out/renderer/index.js`, `files: ["out/**/*"]` | `engines.freelens: ^2.0.0`, `engines.node: >= 24.0.0`, `"type": "module"`, version `1.0.0-0`, `main: dist/main.js`, `renderer: dist/renderer.js`, `files: ["dist/**/*"]` | 03 |
| Dependencies | `package.json` | `@freelensapp/extensions ^1.10.1`, React 17, `@types/react` 17, mobx 6.13.7, mobx-react 7.6.0, TypeScript 5.9.3, Vitest 4, `@types/node` 24.12, `sass`, `vite-plugin-sass-dts`, `electron-vite`, `@electron-toolkit/tsconfig`, `@babel/plugin-proposal-decorators`, `react-markdown` 6, `remark-gfm` 1 | the nightly pinned exactly; the `main` branch's versions of every package both branches use (React 19.3.1, mobx 7.0.6, mobx-react 10.0.2, TypeScript 7.0.2, Vite 8.3.4, Vitest 5.0.4, `sass-embedded`, `electron` types, `esbuild`, `monaco-editor`, `react-markdown` 10, `remark-gfm` 4, ...); the host-provided libraries as development dependencies only; pi 1.4.0, `typebox`, `react-select` (types only), `loglevel`, `lucide-react` and `yaml` bundled; the v1 build packages removed | 03 |
| Package manager | `package.json`, `pnpm-workspace.yaml` | pnpm 10.34.4, `onlyBuiltDependencies` | pnpm 12 with the `main` branch's `pnpm-workspace.yaml` (`allowBuilds`, `engineStrict`, `minimumReleaseAgeExclude`, `strictPeerDependencies`) | 03 |
| Build | `electron.vite.config.js` | electron-vite: main as a CJS lib, the renderer as a CJS `preload` lib, `preserveModules` (`VITE_PRESERVE_MODULES`, `build:production`), legacy decorators through oxc and Babel `2023-05`, `vite-plugin-sass-dts` | `vite.config.mjs` and `build/vite-plugin-*.mjs` from the `main` branch: two Vite runs, the renderer for the browser, main for Rolldown's `node` platform, standard decorators lowered, one stylesheet, CSS module declarations written by the build plugin; the main bundle one file without code splitting | 03 (removal), 04 |
| Host modules | `build/global-externals.js` | `global.LensExtensions`, `global.Mobx`, `global.MobxReact`, `global.React`, `global.ReactDom`, `global.ReactRouterDom`, `global.ReactJsxRuntime` | `globalThis.FreelensExtensionApi.<Name>` (C3), main maps only `mobx`; no `react-router-dom` | 03 (removal), 04 |
| HTTP and cluster access (C12) | `src/main/agent/`, `src/renderer/business/agent-client/freelens-cluster.ts`, `cluster-tools.ts`, `tool-runner.ts` | HTTP: pi sends its model requests, OAuth logins and model-list refreshes with Node's global `fetch` from main; the renderer makes no HTTP request. Cluster: the cluster tools run in the cluster frame on the host singletons (`apiManager.getStore`, `apiManager.getApiByKind`, `podsApi.getLogs`, `namespacesApi`, `eventApi`, `deploymentApi`, `daemonSetApi`, `statefulSetApi`) and on the protected `KubeApi.request`, reached through structural casts, for `GET /version` and the subresource `PATCH`. No kubectl or helm, no bundled Kubernetes client | the tools run in main on `Main.K8sApi.KubeJsonApi.forCluster(clusterId)`, by path (ADR 0002; in between, the frame's `Renderer.K8sApi.KubeJsonApi.forCluster` replaces the casts); pi's model requests carry `Main.Util.fetch`, except the Google Generative AI and Google Vertex adapters, which refuse a custom fetch; OAuth logins and model-list refreshes stay on Node's `fetch` | 06, 09, 10, 11 |
| Node and Electron in the renderer | `src/renderer/navigation/navigate-to-extension-preferences.ts`, `extension-preferences.ts` | `require("electron").ipcRenderer.invoke("ipc:broadcast-main", "renderer:navigate", "/preferences/<id>")` on a host-internal channel, with the route built from `sanitizedExtensionId` | `navigateToPreferences()` on the `LensRendererExtension` instance ("Node and Electron in the renderer" in the guide) | 06 |
| Removed host API | `src/renderer/pages/preferences/provider-settings.tsx` | `Common.Util.openExternal(url)` for the OAuth sign-in page | `window.open(url)`: the host hands an `http:` or `https:` URL to the system browser ("openExternal, openBrowser" in the guide) | 06 |
| Extension route | `src/renderer/components/menu-entry/menu-entry-hook.tsx` | `Renderer.Navigation.navigate("/extension/freelensapp--ai-extension/ai-extension-main-page")` | `extension.navigate(MAIN_PAGE_ID)`, the extension handed over from the registration, as on the `main` branch | 06 |
| Menu item registration | `src/renderer/index.tsx`, `src/renderer/components/menu-entry/menu-entry.tsx` | `kubeObjectMenuItems` with `kind: "Event"` and `apiVersions: ["v1"]` written out, props typed `Renderer.Component.KubeObjectMenuProps<KubeEvent>` | `Renderer.K8sApi.menuItemFor(Renderer.K8sApi.KubeEvent, { MenuItem })`, props `Common.Types.KubeObjectMenuItemProps<KubeEvent>` (C6) | 06 |
| Pages and preferences | `src/renderer/index.tsx` | `Page: () => <MainPage />`, `Input: () => <PreferencesPage />`; the page reaches the preferences and its own route through module state | the extension instance passed from the registration (`Page: () => <MainPage extension={this} />`, C6, C9) | 06 |
| Error boundaries | `src/renderer/index.tsx` | none: an error in the chat page, the menu item or the preferences takes the cluster view or the preferences with it | `src/renderer/components/error-boundary.tsx` of the `main` branch around every component of `clusterPages`, `kubeObjectMenuItems` and `appPreferences` | 06 |
| Stores | `src/common/store/preferences-store.ts`, `src/main/index.ts`, `src/renderer/index.tsx` | `PreferencesStore extends Common.Store.ExtensionStore` with an annotation map on plain fields (`makeObservable(this, { ... })`); `// @ts-ignore` on `getInstanceOrCreate` in both entries | the v2 base class (`BaseExtensionStore`) has no `accessor` field and leaves `fromStore`/`toJSON` to the subclass, so the annotation map on plain fields stays (the values the host saves stay own properties, as on the `main` branch); `getInstanceOrCreate<S>()` is typed, so the `@ts-ignore` goes | 06 |
| Old-host fallbacks | `src/main/index.ts`, `src/renderer/business/agent-client/agent-client.ts` | `Main.Catalog?.getClusterById?.()`, `Main.Catalog?.getAllClusters?.()`, `Renderer.Catalog.getClusterById?.()` for Freelens before 1.10 | direct calls; v2 guarantees them | 06 |
| Decorators | `src/` | none in the source; the build configures legacy decorators | standard decorators lowered by the build plugin; nothing to migrate in the source | 03, 04 |
| CSS | `chat`, `code-block`, `interrupt`, `markdown-viewer`, `message`, `text-input`, `pages/main` | seven `*.scss?inline` imports injected through a `<style>` element | CSS modules imported normally, one `dist/renderer.css` linked by the host (C10), committed `*.module.d.scss.ts` | 04, 06 |
| SVG | `src/renderer/components/freelens-ai-icon/free-lens-ai-icon.tsx` | `extension-icon.svg?raw` | unchanged; the `main` branch keeps the `?raw` import | none |
| React 19 types | `markdown-viewer-hook.tsx`, `code-block.tsx`, `React.FC` users | the global `React` namespace without an import (`React.AnchorHTMLAttributes`, `React.HTMLAttributes`) | React 19 types, imported | 06 |
| Markdown | `src/renderer/components/markdown-viewer/` | react-markdown 6 hands the `code` renderer an `inline` flag; remark-gfm 1 | react-markdown 10 and remark-gfm 4 (the `main` branch's versions): no `inline` flag, a block is a `code` inside a `pre` (see the `main` branch's 277bea9) | 06 |
| Runtime contexts | `src/common/` | made process-neutral by ticket 02; `src/common/agent-protocol.ts` still imports pi's types | the protocol keeps pi's shapes, or declares them itself if pi's declarations pull Node into the renderer or common program | 05 |
| TypeScript | `tsconfig.json` | one program extending `@electron-toolkit/tsconfig/tsconfig.node.json`, `moduleResolution: node10`, `types: ["vite/client", "electron-vite/node"]`, `paths` for `@vitejs/plugin-react` and two `@earendil-works/pi-ai` subpaths, Node and the DOM together | `tsconfig.base.json`, one program each for main, renderer, common, tests and tooling, the environment tests; the `paths` only if Bundler resolution still needs them | 05 |
| Tests | `vitest.config.ts`, `src/**/*.test.ts` | Vitest 4 in a Node environment; the 25 test files already import from `vitest`; no stub of `@freelensapp/extensions` | the `main` branch's Vitest config and `test/freelens-extensions.ts`, the tests' own program, `vitest` banned outside tests; a new extension entry test | 07 |
| Lifecycle | `src/main/index.ts`, `src/renderer/index.tsx` | main disposes the agent host and the provider service in `onDeactivate`; the renderer has no `onDeactivate`, its clients start once per frame behind module-level guards | activate, deactivate, activate leaves one handler per IPC channel and one agent host; deactivating during a run stops it | 07 |
| Lint | `biome.jsonc`, `knip.jsonc` | Biome 2.5.1; Knip with the electron-vite config, ignoring `@babel/plugin-proposal-decorators` and `electron` | the `main` branch's files | 08 |
| Integration | `integration/__tests__/extensions.tests.ts`, `.github/workflows/integration-tests.yaml` | matrix `freelens_version: v1.10.0` | the `main` branch's integration tests against Freelens v2 | 08 |
| Release and CI | `check.yaml`, `release.yaml`, `unit-tests.yaml`, ... | `build:production`, `VITE_PRESERVE_MODULES=false`, the type check in `check.yaml` | the `main` branch's workflows, the dedicated type-check workflow | 08 |
| Metafiles | `.renovaterc.json5`, `mise.toml`, `.nvmrc`, `.trunk/trunk.yaml` | Node 24.15.0 without `mise.lock`; Renovate in JSON5 | the `main` branch's files | 08 |
| Docs | `README.md`, `AGENTS.md`, `docs/BUILD.md`, `docs/SET_UP_EXTENSION.md` | v1 requirements, CJS, the globals table, React 17, `pack:dev` as the install path, the template's gateway-api sections | v2 throughout; the pi agent on v2 as it is | 12 |

### API symbols checked in the pinned declaration

Every host API symbol the branch uses was looked up in
`dist/extension-api.d.ts` of the pinned nightly:

- Present with a compatible signature: `Main.LensExtension`
  (`getExtensionFileFolder`), `Main.Ipc` (`createInstance`, `handle`,
  `broadcast`), `Main.Catalog.getClusterById`, `Main.Catalog.getAllClusters`,
  `Renderer.LensExtension` (`sanitizedExtensionId`, `navigate`,
  `navigateToPreferences`), `Renderer.Ipc` (`createInstance`, `listen`,
  `invoke`), `Renderer.Catalog.getActiveCluster`,
  `Renderer.Catalog.getClusterById`, `Renderer.Navigation.navigate`,
  `Renderer.Component` `Button`, `HorizontalLine`, `Icon` and `IconProps`,
  `Input`, `MenuItem`, `MonacoEditor`, `Select` and `SelectOption`, `Spinner`,
  `Switch`, `createTerminalTab`, `terminalStore`, `Renderer.K8sApi`
  `KubeObject`, `KubeEvent`, `apiManager` (`getStore`, `getApiByKind`),
  `podsApi` (`getLogs`), `namespacesApi`, `eventApi`, `deploymentApi`,
  `daemonSetApi`, `statefulSetApi`, `Common.Store.ExtensionStore`
  (`getInstanceOrCreate`, `loadExtension`, `fromStore`, `toJSON`), and the
  registration fields `clusterPages`, `clusterPageMenus`, `appPreferences`,
  `kubeObjectMenuItems`.
- Present, but not what the host passes: `Renderer.Component.KubeObjectMenuProps`
  is the props type of the host's own `KubeObjectMenu`; a menu item gets
  `Common.Types.KubeObjectMenuItemProps`.
- Removed: `Common.Util.openExternal`.
- New symbols the port uses: `Renderer.K8sApi.menuItemFor`,
  `Main.K8sApi.KubeJsonApi.forCluster`, `Renderer.K8sApi.KubeJsonApi.forCluster`,
  `Main.Util.fetch` (`typeof fetch`).

### Already compatible, verify only

No `react-router-dom`, `Renderer.Component.List`, `forRemoteCluster` or
built-in store classes (the frame-side tools reach stores through
`apiManager.getStore`, and ticket 10 removes them); no class components,
`@observer` or `this.props`; no custom resource presented by the extension, so
`customResources` stays unset; no shipped executables, kubectl or helm
(`binaries.md` and C15 do not apply).

## Decisions

From the spec; the spec is the full text.

- **Version:** `1.0.0-0`, the premajor of 0.7.1, as on the `main` branch.
- **How the port is done:** the pi agent branch is ported on its own through
  the skill's steps, with the `main` branch as the reference; the `main` branch
  is merged once at the end (ticket 14), keeping the pi agent side where the
  code differs and the `main` branch's side where only tooling differs.
- **Order:** pi 1.4.0 (01) and process-neutral common code (02), steps 0 to 6
  (03 to 08), the feature steps F1 (cluster tools in main, 09 and 10) and F2
  (the Freelens HTTP client for pi, 11), step 7 (12), the manual test cases
  (13), the final merge (14).
- **Commits:** one commit per step, plain subjects. Steps 1 to 5 (tickets 03
  to 07) stay local until the tree is green again, then each step is pushed.
  Workflows are edited directly.
- **Agent host and IPC (ADR 0001):** the frames keep talking to the agent host
  over Freelens IPC; no HTTP/SSE bridge.
- **Cluster tools in main (ADR 0002):** by path through
  `Main.K8sApi.KubeJsonApi.forCluster`, kinds resolved from discovery, pi's
  abort signal per request, the backup YAML on the approval request.
- **Model requests:** through `Main.Util.fetch` by wrapping the session's
  stream function; the Google adapters, OAuth logins and model-list refreshes
  stay on Node's `fetch`, documented as a gap.
- **Build:** the main bundle is one file without code splitting, so a
  development reload re-evaluates all of pi; pi's OAuth login modules stay
  registered statically at startup.
- **Integration tests:** the `main` branch's, against Freelens v2 (ticket 08).
- **Where it lands:** on `piagent`, the branch of PR #290; PR #290 lands after
  the maintainer's manual checks and the final merge.

Open: none.

## Steps

- [x] **01. pi 1.4.0 on the current toolchain.**
- [x] **02. Common code is process-neutral.**
- [x] **Step 0. Plan record (03).** This file.
- [x] **Step 1. Manifest and toolchain (03).**
- [x] **Step 2. Vite build (04).**
- [x] **Step 3. TypeScript layout and environment tests (05).**
- [x] **Step 4. Source migration (06).**
- [x] **Step 5. Unit tests on Vitest 5, tree green again (07).** Steps 1 to 5
      are pushed here.
- [x] **Step 6. Tooling and CI from the `main` branch (08).**
- [x] **F1. Read tools in main (09), write tools and the backup in main (10).**
- [x] **F2. Model requests through the Freelens HTTP client (11).**
- [x] **Step 7. AGENTS.md and README (12).**
- [x] **Manual test cases for Freelens v2 (13).** `manual-test-cases.md`.
- [ ] **Final merge of the `main` branch (14).**

### Validation per step

```sh
pnpm install --frozen-lockfile
pnpm type:check
pnpm biome:check
pnpm test:unit
pnpm build
pnpm knip:check   # from step 6 on, after the build
```

Steps 1 to 4 build only together: their reports say which checks fail and
why. From step 2 on, every build is followed by the checks of the built
output (`pnpm check:dist`, which `pnpm build` runs as its `postbuild`):

- [ ] `dist/main.js` loads in plain Node with a stand-in
      `globalThis.FreelensExtensionApi`, and its default export is the
      extension class
- [ ] no `global.` host reference in either bundle; no `require(` in the
      renderer bundle, and in the main bundle only Rolldown's `__require`
- [ ] no bare import of a host module (`react`, `react-dom`,
      `react/jsx-runtime`, `mobx`, `mobx-react`, `monaco-editor`) and no second
      copy of React or mobx
- [ ] no Node builtin in the renderer bundle
- [ ] the main bundle imports nothing but Node builtins and Electron
- [ ] no unlowered decorator in the output
- [ ] one stylesheet, `dist/renderer.css`; `dist/` holds only the main entry,
      the renderer entry and the stylesheet, with their source maps

## Functional checks

Run by the maintainer in Freelens v2 from the directory install; ticket 13
turns them into manual test cases with steps and expected results.

- [ ] the extension is accepted at discovery and loads without an error in
      either process
- [ ] a rebuild under `pnpm dev` reloads the extension without restarting
      Freelens and leaves one agent host and one handler per IPC channel
- [ ] a preference changed in the UI is followed through mobx without
      reopening the page
- [ ] the "Freelens AI" cluster menu entry, with its icon, opens the chat page
- [ ] a prompt streams the answer, with the reasoning, the tool calls and
      their results, tokens, cost, the context gauge and the compaction line
- [ ] Stop ends a run, including a cluster request in progress; New chat and
      Delete all chats work
- [ ] reopening the cluster frame, even mid-run, and restarting Freelens
      restore the chat; two clusters each show only their own chat
- [ ] "Connect a provider" opens this extension's preferences tab
- [ ] code blocks render in the editor, with Copy, Run and the managed fields
      toggle
- [ ] the read tools (namespaces, version, warning events, list and get of any
      kind, pod logs) and the write tools (create, update, patch, scale,
      delete, delete pod with evict, force and finalizers, restart) work; a
      disconnected cluster answers "cluster not connected"
- [ ] every change waits for approval; the card shows the backup YAML;
      approve, deny, "Approve all in this chat" and the per-tool settings
      work; Stop and New chat deny a pending approval
- [ ] providers connect with an API key and with an OAuth login whose page
      opens in the browser; custom endpoints and environment keys show
- [ ] the chat follows the Freelens proxy and CA preferences, except the
      Google and Bedrock providers and Codex's WebSocket transport (F2)
- [ ] "Explain" on a warning event opens the chat with the explanation
- [ ] every preference is shown, saved and followed; an error in the chat
      page, the menu item or the preferences stays inside it
- [ ] the styles apply in the light and the dark theme
- [ ] disabling the extension during a run stops it without an error in the
      main-process log

## Findings

### Before the port (tickets 01 and 02)

- **pi 1.4.0 changes that do not apply to the extension (01).** Checked and
  left alone: the Kimi `models.json` base URL now needs `/v1` (the extension
  writes only custom OpenAI-compatible providers); `generateSummary` ignores
  `reserveTokens` (the compaction tests still pass); the theme schema; the
  attribution headers; the default model changes; the removed chord. Resumed
  sessions keep the extension's tools active on 1.4.0: a tool call after a
  restart still reaches the frame (checked by hand with a throwaway test).
- **pi 1.4.0 changes that apply (01).** `before_agent_start` is a union on
  `messageType` and also fires for `pi.sendMessage(..., { triggerTurn: true })`;
  the handler only touches `event.systemPromptOptions.sections`, which both
  members have, so no source change was needed. pi renamed the Azure provider
  `azure-openai-responses` to `azure`: `src/main/agent/azure-rename.ts` moves
  the saved key and the chat's model at startup and stays when the main entry
  is rewritten.
- **Azure entries in `models.json` are not moved (01).** An
  `azure-openai-responses` entry a user wrote by hand into `models.json` is
  ignored by pi 1.4.0. Only pre-release testers can have one; not handled.
- **pi needs Node >= 22.19 (01).** The v2 manifest asks for Node >= 24, which
  covers it.
- **Common code is process-neutral (02).** The React-based logger moved to the
  renderer, with a plain logger for main and a shared `createLogger`; the
  unused `setLogLevel` went. The chat message object types moved into
  `src/common/objects/`. Nothing in `src/common` imports React, renderer or
  main code; the pi type imports of `agent-protocol.ts` (and through it
  `message-object.ts`) are left for ticket 05.
- **The main process logs through loglevel (02).** The `console.error` and
  `console.warn` calls of main go through `useLog("freelens-ai")`. loglevel
  binds the console method when its level is set, so a test that spies on
  `console.*` creates the logger after the spy.

### Port

- **pnpm 12 refuses the build scripts of two of pi's dependencies (step 1).**
  With the `main` branch's `pnpm-workspace.yaml`, `pnpm install` fails with
  `ERR_PNPM_IGNORED_BUILDS` for `@google/genai` (a preinstall that does
  nothing) and `protobufjs` (a postinstall for its command-line tools). pnpm 10
  ignored both before, since neither was in `onlyBuiltDependencies`. Both are
  set to `false` in `allowBuilds`, which keeps that behaviour; this is the one
  difference from the `main` branch's file. Upstream: none.
- **Two majors in the bundled renderer libraries (step 1).** Matching the
  `main` branch moves `react-markdown` from 6 to 10 and `remark-gfm` from 1
  to 4. react-markdown 10 no longer passes `inline` to the `code` renderer, so
  the markdown viewer needs the change the `main` branch made in 277bea9. Step
  1 changes the versions only; ticket 06 adapts the code. Upstream: none.
- **Packages only this branch has (step 1).** pi (`@earendil-works/pi-ai`,
  `@earendil-works/pi-coding-agent`) and `typebox`, for the tool parameters,
  stay bundled at their versions. `react-select` stays at 5.10.2 for its
  `SingleValue` type, as `@freelensapp/extensions` depends on `^5.10.2`.
  `jsdom` and `@testing-library/*`, which the `main` branch has for its
  component tests, are not added: no test here renders a component; ticket 07
  adds them if one does.

- **The main bundle is one 13.5 MB file (step 2).** `vite.config.mjs` and the
  three `build/vite-plugin-*.mjs` are the `main` branch's; the one difference
  is `output.codeSplitting: false` for the main run (Rolldown's replacement of
  the deprecated `inlineDynamicImports`). With code splitting the main run
  wrote 63 chunks next to `main.js`, most of them pi's providers and the
  libraries pi-coding-agent loads with `import()` (jiti, Babel, TypeScript,
  photon). pi's OAuth login modules are in the bundle through the static
  `registerBunOAuthFlows` import. Upstream: none.
- **The build reads the root `tsconfig.json` (step 2).** Vite's oxc transform
  loads the nearest `tsconfig.json`, and its `extends` of the removed
  `@electron-toolkit/tsconfig` failed every build and every test file. Step 2
  deletes only that `extends` line; ticket 05 replaces the file. With it gone,
  `pnpm test:unit` passes again (25 files, 349 tests); `pnpm type:check` still
  fails on `moduleResolution: node10` and `electron-vite/node`. Upstream: none.
- **The checks of the built output are a script (step 2).** The `main` branch
  ran them by hand for its PR. Here `build/check-built-output.mjs`
  (`pnpm check:dist`) runs them after every `pnpm build`, as its `postbuild`
  script, which pnpm 12 runs. It reads the bundles with Vite's `parseAst`
  rather than searching the text, since the main bundle has `require(` and
  decorators in comments and strings of the libraries it inlines, and it finds
  an inlined copy of a host module through the source maps. One check is added
  to the list in "Validation per step": the main bundle imports only Node
  builtins and Electron, because the load in plain Node runs inside the
  checkout, where a bare import resolves from `node_modules` but Freelens
  installs none. The stand-in `FreelensExtensionApi` has only what the bundle
  reads when it loads (`Main.LensExtension`, `Main.Ipc`,
  `Common.Store.ExtensionStore` and the installed mobx). Upstream: the
  template, which runs the checks by hand (see "Upstream work items").
- **The renderer build fails on Electron, as it should (step 2).** The
  `no-node-in-renderer` plugin rejects the `require("electron")` of
  `src/renderer/navigation/navigate-to-extension-preferences.ts`; ticket 06
  replaces it with `navigateToPreferences()`. With that call stubbed out (a
  throwaway, not committed) the renderer builds and the checks pass except for
  the missing `dist/renderer.css`: the seven `?inline` stylesheets emit no CSS
  file. No `*.module.scss` exists yet, so the build writes no declaration;
  ticket 06's CSS modules bring both. Upstream: none.
- **pi's declarations bring Node into every program that imports them
  (step 3).** Every entry point of pi's packages (`@earendil-works/pi-ai`, its
  `compat` subpath, `@earendil-works/pi-coding-agent`), imported for types
  only, reaches `@types/node` through the provider SDKs it exports
  (`@anthropic-ai/sdk`, `openai` and `undici-types`, which reference Node's
  types). With `src/common/agent-protocol.ts` importing `AssistantMessage`,
  `UserMessage`, `JsonAgentSessionEvent` and `SessionStats`, the environment
  tests of the renderer and the common program reported all four Node lines
  of `node-apis.ts` as unused `@ts-expect-error` directives. So the protocol
  now declares the shapes itself: the content parts, `UserMessage`,
  `StopReason`, `AssistantMessage` and the other roles of `AgentMessage`, the
  assistant message events, `JsonAgentSessionEvent` and `SessionStats`, each
  with the fields the frames and the agent host's tests read, and the event
  types and message roles the frames ignore listed by name. Main still sends
  pi's objects unchanged; the agent host's type check holds them to these
  declarations, so an event type or a role pi adds fails `type:check:sources`
  until the protocol lists it (checked by removing one of each). Nothing in
  the renderer or the tests changed for it. Upstream: pi (see "Upstream work
  items").
- **The tsconfig layout is the `main` branch's, file for file (step 3).**
  `tsconfig.base.json`, the root `tsconfig.json` (tooling), `src/tsconfig.json`
  (tests), `src/{main,renderer,common}/tsconfig.json`, `environment-tests/*`
  and the five `type:check*` scripts are copied unchanged. The `paths` the old
  root config needed for `@vitejs/plugin-react` and two `pi-ai` subpaths are
  gone: Bundler resolution reads the packages' `exports`. The test program
  includes `../test/**/*`, which does not exist yet (ticket 07). Upstream:
  none.
- **What the split leaves for step 4 (step 3).** With the environment tests
  passing, `pnpm type:check` stops at `type:check:sources` on the errors the
  source migration fixes: `observable.ref` in
  `src/common/store/preferences-store.ts` (mobx 7, in every program), and in
  the renderer `require("electron")` in `navigate-to-extension-preferences.ts`
  (no Node types in the renderer program any more), `Common.Util.openExternal`
  in `provider-settings.tsx`, the `inline` prop in `markdown-viewer.tsx`
  (react-markdown 10) and the untyped `onAction` parameter in
  `interrupt.tsx` (the base config's `noImplicitAny`). The tooling and test
  programs pass. Upstream: none.

- **mobx 7 names its annotation modifiers (step 4).** `observable.ref` is gone;
  the preferences store uses the named export `observableRef` in its
  annotation map, which stays on plain fields (`makeObservable` after the field
  initializers), so the values `toJSON()` returns stay own properties. The
  `@ts-ignore` on `getInstanceOrCreate` in both entries was no longer needed.
  Upstream: none.
- **Two class names and an id needed care as CSS modules (step 4).** The seven
  `?inline` stylesheets are now `*.module.scss`, imported as `styles` and
  written into `dist/renderer.css`; the build wrote the eight committed
  `*.module.d.scss.ts` (the seven and the `main` branch's error page). Three
  selectors in `text-input.module.scss` name things outside the module:
  `body.theme-light` (the host's theme class) and react-select's
  `.Select__single-value` and `.Select__value-container` are wrapped in
  `:global(...)`; the `#send-button, #stop-button` rule went into
  `.text-input-send-button`, which both buttons have, because CSS modules
  localize ids too (checked in a build: `#send-button` became
  `#_send-button_<hash>`). The `main` branch did the same. The plain class
  names `chat-button`, `active` and `text-input-vertical-list` have no rule and
  stay strings. Upstream: none.
- **The preferences and the chat page are reached through the extension
  (step 4).** The chat page gets the extension from its registration
  (`<MainPage extension={this} />`) and hands it to the application context,
  whose `navigateToPreferences()` calls the extension's; the "Connect a
  provider" button uses it. `navigation/extension-preferences.ts`, its test (3
  cases of the route, 1 of the broadcast) and
  `navigate-to-extension-preferences.ts` are deleted, so the unit tests went
  from 349 to 346 with the new `menu-entry-hook.test.ts`. The menu item takes
  `Common.Types.KubeObjectMenuItemProps<KubeEvent>` and the extension, is
  registered with `menuItemFor(KubeEvent, ...)`, and opens the chat with
  `extension.navigate(MAIN_PAGE_ID)`. The `main` branch's `error-boundary.tsx`
  and `error-page.tsx` wrap `clusterPages`, `kubeObjectMenuItems` and
  `appPreferences`; their component tests (`error-boundary.test.tsx`,
  `error-page.test.tsx`) and the markdown viewer's need jsdom and Testing
  Library, which ticket 07 adds. Upstream: none.
- **The markdown viewer follows react-markdown 10 (step 4).** The viewer and
  its hook are the `main` branch's after 277bea9: a `pre` renderer marks its
  content as a block through a context, so the `code` renderer knows inline
  code from a fenced block without the removed `inline` prop; the renderers
  drop react-markdown's `node`. Upstream: none.
- **The frame-side tools use the frame's JSON client (step 4).** `/version`
  and subresource patches go through
  `Renderer.K8sApi.KubeJsonApi.forCluster(getActiveClusterId())` instead of a
  structural cast into the protected `KubeApi.request`; the resource URL still
  comes from the public `formatUrlForNotListing`. Both clients use the same
  `/api-kube` base in Freelens. The old-host fallbacks went: the catalog calls
  (`Main.Catalog.getClusterById`, `getAllClusters`,
  `Renderer.Catalog.getClusterById`, `getActiveCluster`) are direct, without
  optional calls or `try`. Ticket 10 deletes these tools. Upstream: none.
- **`openExternal` is `window.open` (step 4).** The sign-in page and the
  device-code links of a provider login open with `window.open(url)`, still
  only for `http:` and `https:` URLs. Upstream: none.

- **pi's model requests carry the host's fetch, with gaps (F2).** The agent
  host takes a `fetch` option, which the main entry sets to a function that
  calls `Main.Util.fetch`, read when each request is sent.
  After each session is created, the chat's and AI Explain's alike, its
  `agent.streamFunction` (public and writable in pi) is wrapped to add that
  `fetch` to the options of every model request. The chat's runs, its
  compaction summaries (pi passes `agent.streamFunction` to `compact()`) and
  pi's prompt-cache warmer (which reuses the options the stream function
  built) all go through it. Nothing replaces the global `fetch` or the global
  undici dispatcher of the main process. Requests that stay on Node's own HTTP,
  without the Freelens proxy and CA settings:
  - models on the `google-generative-ai` and `google-vertex` APIs: pi's two
    adapters throw "Custom fetch is not supported" when given a `fetch` other
    than `globalThis.fetch` (`pi-ai/dist/api/google-generative-ai.js`,
    `google-vertex.js`), so the wrapper leaves those requests alone;
  - models on `bedrock-converse-stream`: the AWS SDK sends them through its
    own Node HTTP handler, ignoring `fetch`; pi gives it a proxy agent only
    from the `HTTPS_PROXY`/`HTTP_PROXY` environment variables;
  - the WebSocket transport of `openai-codex-responses`, which pi tries first
    under its default `transport: "auto"` before falling back to SSE over
    `fetch`; it too takes its proxy only from the environment;
  - OAuth logins and token refreshes (`pi-ai/dist/auth/oauth/*.js`) and
    model-list refreshes (for example `providers/openrouter.js`), which call
    the global `fetch` directly and do not go through the stream function.
  The tests check that the injected `fetch` reaches the faux provider's
  request options in a chat run, an explanation and a compaction, that a model
  on either Google API gets none, and that a request of the entry's chat goes to
  `Main.Util.fetch`.
  Upstream: pi (see "Upstream work items" for the request text; not filed
  yet, the link goes here once it is).

- **The tests run on the `main` branch's Vitest setup (step 5).**
  `vitest.config.ts` is the `main` branch's verbatim: the standard decorators
  plugin and `@vitejs/plugin-react` as in the build, `globals` on for Testing
  Library's cleanup, `dist/**` excluded, and `@freelensapp/extensions`
  aliased to `test/freelens-extensions.ts`. The stub is the `main` branch's
  file plus what the extension entry needs: `Main.LensExtension` gets the
  host's lifecycle (`activate()` runs `onActivate`; `disable()` awaits
  `onDeactivate`, then runs the disposers) and a `getExtensionFileFolder()`
  that the test points at a temporary folder, and `Main.Ipc` is a singleton
  per subclass whose `handle` keeps the handlers in an exported
  `ipcMainHandlers` map, throws on a second handler for a channel as Electron
  does, and removes them on `disable()`, as the host does. Biome gets the
  `main` branch's two `noRestrictedImports` overrides: `vitest`, React's
  `act`, `react-dom/test-utils` and Testing Library only in tests and
  `test/`. The rest of `main`'s `biome.jsonc` is step 6's. Upstream: none.
- **The extension entry test (step 5).** `src/main/index.test.ts` drives
  `LensExtensionAiMain` in the host's order (new instance, `activate()`,
  `enable()`, `disable()`) with pi's faux provider registered on the
  `ModelRuntime` the entry creates (a spy on `ModelRuntime.create`). It
  checks that a prompt sent to the agent channel's handler streams envelopes
  to the end; that after a deactivation during a run and a new activation
  there is one handler per channel, the first host's model request is
  aborted, and the new run's envelopes come from one session with
  consecutive `seq`; and that deactivating during a run aborts the model
  request, broadcasts nothing more and logs no error. The entry needed no
  change: removing `this.agentHost?.dispose()` from `onDeactivate` fails the
  last two cases. Upstream: none.
- **Component tests from the `main` branch (step 5).** `error-boundary`,
  `error-page`, `markdown-viewer` and `interrupt` tests are copied
  unchanged, with `jsdom` 30.1.2, `@testing-library/react` 16.3.3 and
  `@testing-library/dom` 10.4.2 (the `main` branch's versions). The
  interrupt test found the missing `key` on the option buttons, which the
  `main` branch had fixed; the same one-line fix is in this step.
  `menu-entry-hook.test.ts` is the `main` branch's (the real store on the
  stub, `resetInstance()` after each case). Not copied: the `main` branch's
  `application-context` and `preferences-page` tests, whose components differ
  entirely here. Unit tests: 346 to 367 in 30 files, none removed.
  Upstream: none.

- **The tooling and the workflows are the `main` branch's (step 6).** Copied
  unchanged: `biome.jsonc`, `mise.toml`, `mise.lock`, `.nvmrc`,
  `.editorconfig`, `.gitattributes`, `.gitignore`, `.markdownlint.yaml`,
  `.claude/settings.json` (the `.gitignore` names it) and every workflow,
  `claude-task.yaml`, `mise-lock-check.yaml` and `type-check.yaml` added,
  `osv-scanner.yaml` deleted as on the `main` branch; `.renovaterc.json5`
  became `.renovaterc.json`. The scripts take the `main` branch's Biome
  2.5.15, Knip 6.41.0 (`--files --no-config-hints`), `test`, `bump-version`
  and the `clean:dist` family; `postupdate` and `clean:out` went. What
  differs, and why: `package.json` keeps `postbuild` and `check:dist` (step
  2) and its own packages; `knip.jsonc` lists pi and `typebox` instead of
  LangChain and `zod` among the bundled libraries the production pass would
  report as unlisted; `.renovaterc.json` excludes `@earendil-works/**` and
  `typebox` instead of `@langchain/**` from the Freelens catalog rule (the
  Freelens catalog has neither; it has `react-select`); `.trunk/trunk.yaml`
  ignores `.claude/skills/**`, the agent skills vendored as they are, which
  failed Trunk Check on this branch before; the integration helper waits for
  the "Thinking level" heading instead of the `main` branch's "API key" label,
  which this preferences page does not have. `pnpm-workspace.yaml`
  (step 1), `vite.config.mjs` (step 2) and `test/freelens-extensions.ts`
  (step 5) keep their differences. Upstream: none.
- **The new linters reformat three files (step 6).** Biome 2.5.15 formats
  one `it.each` of `src/main/agent/agent-host.test.ts` differently; Trunk's
  Prettier, which the `main` branch runs on SCSS, splits one `transition` of
  `text-input.module.scss`; the `main` branch's markdownlint rules (MD045,
  MD049) needed the four image alt texts and the emphasis style of the
  `main` branch's `docs/SET_UP_EXTENSION.md`, and one `<base URL>` in an
  old `.scratch` ticket went into backticks. Nothing else in the source
  changed; Knip found nothing to remove. Upstream: none.
- **The read tools run in main (F1, 09).** The agent host runs
  `getClusterVersion`, `getNamespaces`, `getWarningEventsByNamespace`,
  `listKubernetesResources`, `getKubernetesResource` and `getPodLogs` itself
  (`src/main/agent/tools/read-tools.ts`); every other tool still goes to the
  frame as a `tool_request` until ticket 10. The host gets three new options:
  `getClusterStatus` (the catalog's `status`, undefined for a cluster Freelens
  does not know), `getClusterApi` (`Main.K8sApi.KubeJsonApi.forCluster`) and
  `getPodLogsTailLines` (the preference, read per call). A status other than
  `connected` is the error result "Cluster not connected" and no client is
  asked for. A rejection becomes the error result `<tool> failed: <text>`, as
  the frame's runner wrote it, with the text from `describeRequestError`
  (`Error`, Kubernetes `Status`, the host's parsed error by its string form).
  Each request carries pi's signal for the call and there is no timeout. The
  path helpers (`resource-paths.ts`) and their tests are the `main` branch's;
  a failed discovery request answers "Could not resolve a Kubernetes API" as
  there, unless the call was aborted. The frame's read implementations and
  their 24 tests on the fake `Cluster` are gone (main never sends a read to
  the frame any more), replaced there by one test that the frame has exactly
  the write tools; the write tools and their tests are untouched. Unit
  tests: 367 to 392 in 33 files. Upstream: freelensapp/freelens (see
  "Upstream work items").
- **A missing object is an error result now (09).** The frame's tools turned
  a 404 into "The Pod "x" was not found."; in main, a GET answered 404 rejects
  with the host's `JsonApiErrorParsed`, which keeps the `Status` private and
  is not exported, so the tool cannot tell a 404 from another failure without
  reading host internals. The model gets `getKubernetesResource failed:
  <the server's message>` instead, the shape every other failure has. Upstream:
  freelensapp/freelens.
- **The pinned host still writes unset query fields (09).** At 5e1870e97,
  `JsonApi` serializes the query with `node:querystring`'s `stringify`, which
  writes `undefined` as an empty value (`previous=`) that the API server reads
  as true (#308). The pod logs query therefore carries only the fields that are
  set; a test checks it with `toStrictEqual`. The Freelens tree after the pin
  filters them (`stringifyQuery`). Upstream: none (fixed after the pin).
- **The stand-in cluster client (09).** `test/kube-json-api.ts` is the `main`
  branch's stand-in with four changes: a GET of an unknown path rejects with a
  stand-in of the host's parsed API error (`ParsedApiErrorStandIn`) instead of
  a plain `Status`, as the host does for every failure but a GET answered 403;
  each request records its abort signal; a `hang` option leaves the requests
  of the given paths unanswered until their signal aborts; `installFakeClusters`
  is left out, since the agent host gets the client injected. Its discovery
  documents add `nodes` and `networking.k8s.io/v1` (`ingresses`, an irregular
  plural with a subresource). The agent host tests, the tool tests and the
  extension entry test use it. Upstream: none.
- **The write tools run in main (F1, 10).** The agent host runs every tool
  itself now (`src/main/agent/tools/write-tools.ts`, `WRITE_TOOL_RUNNERS`),
  after the approval gate has validated and prepared the input, with pi's
  signal on each request. What they send, as the host's `KubeApi` does: a
  create POSTs the manifest with the kind, apiVersion, name and (for a
  namespaced kind) namespace set; an update PUTs it with the same four set
  (the host's `update` sets only the name and namespace; the ticket asks for
  all four, and the API server needs the kind and apiVersion in a PUT anyway);
  a patch is a JSON merge patch, a subresource patch a strategic merge patch;
  a delete sends `propagationPolicy=Background`, a force delete adds
  `DeleteOptions` with `gracePeriodSeconds: 0`; "force finalize" is a JSON
  merge patch with `finalizers: []`, as the host's store does it; an eviction
  POSTs an `Eviction` to the pod's `eviction` subresource; a restart is a
  strategic merge patch of the pod template's
  `kubectl.kubernetes.io/restartedAt` annotation, on the plural that
  discovery gives for the kind in `apps/v1`. The tools no longer read the
  object before changing it: the frame did, to answer "The Deployment "x" you
  want to update does not exist", but in main a GET answered 404 rejects like
  the write itself would (09), so a missing object is the error result
  `<tool> failed: <the server's message>` either way, with one request less.
  The stand-in client gains an `answers` option (what a write answers, by
  method and path, or the error it rejects with), `hang` covers writes too,
  and its `/api/v1` discovery lists `services`. Unit tests: 398 to 410 in 32
  files: 25 write tool tests on the stand-in added, the frame's 11 tool tests
  and 6 runner tests removed with their code, the agent host tests 94 to 99
  and the chat reducer tests 36 to 35. Upstream: none.
- **Deleting a pod with its finalizers reports what the cluster did (10).**
  The pod is patched with a JSON merge patch setting `metadata.finalizers` to
  `null`, then force deleted. The host's `PodApi.deleteWithFinalizers` at the
  pin sends a strategic merge patch with `finalizers: []`, which merges the
  list and leaves it in place (#309; the frame called it until now). The
  result is built from the two answers: the finalizers the patched pod still
  lists, a failed patch (the delete still runs, as in the host), the
  finalizers the delete's answer still lists ("marked for deletion but still
  has the finalizers ..."), and a failed delete after the patch, which
  becomes an error result that still says whether the finalizers were
  cleared (a pod already terminating can be gone once they are, so the delete
  then answers "not found"). Only when both steps went through is it "deleted
  and finalizers cleared successfully". Upstream: none (the Freelens tree
  after the pin sends a JSON merge patch).
- **The backup is loaded by the approval gate (10).** Before it asks, the
  gate loads the object an update, patch, delete, pod delete or restart would
  change (`src/main/agent/tools/approval-backup.ts`, kind resolved through
  discovery, with pi's signal) and puts its YAML (apiVersion, kind, metadata,
  spec, status) on the approval request as `backup`; the snapshot's pending
  request carries it too, so a remounted frame shows it. A create, a read
  (pod logs), a cluster that is not connected or a failed load leave it out,
  and the card is shown anyway; a failed load is logged as a warning. Stop
  during the load aborts it and nothing is asked. "Approve all in this chat"
  and a tool whose approval is turned off load nothing. Upstream: none.
- **The frame takes no part in tool calls (10).** Gone: the `tool_request`
  envelope, the `tool_result` command, the snapshot's `pendingToolRequests`,
  the agent host's pending tool requests, its 30-second tool timeout
  (`DEFAULT_TOOL_TIMEOUT_MS`, the `toolTimeoutMs` option) and the "window did
  not answer" and "reloaded while pending, outcome unknown" results; in the
  frame `tool-runner.ts`, `cluster-tools.ts` (the `Cluster` interface),
  `freelens-cluster.ts`, the backup loader, `withApprovalBackup` and the
  message object's `approvalTarget`. The approval request keeps its
  `approval` target, which main reads to load the backup. Upstream: none.
- **AGENTS.md is the `main` branch's, with the pi agent in place of LangChain
  (step 7).** The sections on the build, TypeScript, tests, lint, CI, the
  rules that fail silently, checking in Freelens dev, security and the
  GitHub Actions rules are the `main` branch's, changed where this branch
  differs: the one-file main bundle and `registerBunOAuthFlows()`, the checks
  of the built output (`pnpm check:dist`, which also makes "one CSS asset" and
  "main on the `node` platform" checked rather than silent), pi kept out of
  the renderer and common programs, the stub's lifecycle and `Main.Ipc`, the
  stand-in client's `hang` and `answers`, the integration test's "Thinking
  level" label, pi and `typebox` among the bundled libraries. The LangChain,
  bridge and MCP sections are replaced by "The pi agent": the agent host, the
  IPC protocol (ADR 0001), the cluster tools in main (ADR 0002), approvals,
  providers, HTTP from main with the gaps of F2, and the lifecycle. New rules
  that fail silently: pi in main only, the one-file main bundle, the cluster
  from the command, no unset query field, the injected fetch for every new
  session. The GitHub Actions sections were missing four subsections of the
  `main` branch's file; `claude.yaml` names one of them ("Fork PRs: Review
  Only"), so all four are added. Both Claude workflows read `AGENTS.md` from
  the `main` branch, not from the branch under work, so the CI agent sees
  this file only once it is on `main`. Upstream: none.
- **The README and the guides describe Freelens 2 (step 7).** The README
  gains the requirements, the three ways to install (registry, release
  tarball, directory), a "Proxy and certificates" section with the gaps of F2
  in user terms, and "Build from the source" with the development loop, as on
  the `main` branch; "How it works" no longer says the tools run in the
  cluster's window. `CONTRIBUTING.md` and `docs/BUILD.md` are the `main`
  branch's (broken links, the removed `build:production`, the directory
  install and `pnpm dev`); `docs/SET_UP_EXTENSION.md` takes the `main`
  branch's install steps, and its "Setup API key" step becomes "Connect a
  provider". Its old screenshot of the API key fields,
  `docs/images/preferences_freelens_ai.png`, is no longer referenced and is
  left in place. The pi agent core ticket 08 links ADR 0002. Left for a code
  ticket: two comments still describe the frame-side tools,
  `src/renderer/index.tsx` ("this frame answers its tool calls") and
  `src/main/index.ts` ("The read tools run here"). Upstream: none.
- **What the manual test cases found in the code (13).** Writing the expected
  results against the code turned up behaviour the cases mark as known gaps
  (`manual-test-cases.md`, "Known gaps"): the chat shows no tool calls or tool
  results (the reducer ignores pi's `tool_execution_*` events and the tool-call
  parts), so spec story 9 fails and the cases read the calls from the session
  file; the agent rules text area and the tool list keep dark inline colours
  in the light theme; and, read from the code but not run, the renderer's agent
  and provider clients do not restart after Disable and Enable in a window
  that stays open (module-level `ipc` guards, while Freelens imports a
  development build's renderer from the same URL on Enable). Upstream: none.

### Code review fixes

- **Tool calls and their results are shown in the chat (review, story 9).**
  The chat reducer folds `tool_execution_start` (name and arguments, running)
  and `tool_execution_end` (the result text, or the error) into a tool call
  message under the answer that asked for it; a call still open when the run
  settles is shown as not run. The snapshot now carries the saved tool result
  messages, and the protocol declares pi's `ToolCall` content (id, name,
  arguments) and `ToolResultMessage`, so a remounted frame rebuilds the same
  lines; the calls of an answer that failed or was stopped are left out, as pi
  never runs them. The view (`components/tool-call/`) is one dimmed line with
  the arguments and the result folded under it. The `main` branch shows no
  tool calls, so there was no pattern to copy. Manual case B4 now describes
  it, and K1 is marked fixed. Upstream: none.

- **A failed discovery request is described as what it is (review, story
  27).** `resolveResource` swallowed every rejection of the discovery
  request, so a 403, a 5xx or a network error became "Could not resolve a
  Kubernetes API" for every get, list and write. It now reads the document
  with the client's public `getResponse`, as the pod logs read does, because
  the host's error for a failed `get` keeps the status private (see the 09
  finding and "Upstream work items"): only a 404 answers that text; any other
  answer rejects with the server's `Status` and a failed request with its
  error, which `describeRequestError` turns into `<tool> failed: <message>`.
  The stand-in client's `logs` option became `responses`, which also sets a
  failed discovery answer or an `Error` to reject with, and its `getResponse`
  answers the known paths. Upstream: none.

- **The renderer clients start over after Disable and Enable (review,
  Lifecycle).** `startAgentClient` and `startProviderClient` returned early
  while their module-level `Renderer.Ipc` was set, and nothing reset it, while
  the host drops the instance and its listeners on Disable and Enable
  activates the same loaded module again (manual gap K7). The renderer
  extension now has an `onDeactivate` that stops both clients; the agent client
  also drops its chat, so the next activation loads a new snapshot, and
  ignores a snapshot that answers after the stop. The two
  clients had the same connection shape, now `IpcConnection`
  (`src/renderer/business/ipc-connection.ts`: create the instance, listen on
  the envelope channel, invoke, disconnect), which also removed their casts
  of `createInstance`. The stub gained `Renderer.LensExtension`,
  `Renderer.Ipc` (`ipcRendererListeners`) and `Renderer.K8sApi.menuItemFor`
  for the renderer entry's test (`src/renderer/index.test.tsx`), which loads
  the extension, disables it and loads it again in a cluster frame's URL.
  A4 step 5 and K7 now expect the chat to stream without a frame reload.
  Upstream: none.

- **The frame's cluster id comes from its host name only (review).** The
  chat page's context took `getActiveClusterId()`, which fell back to
  `Renderer.Catalog.getActiveCluster()` and then to a `"default"` id, which
  main would have kept a chat for as if it were a cluster. The context now
  takes `getFrameClusterId()`, moved into `frame-cluster-id.ts`
  (`active-cluster.ts` is gone), and is undefined outside a cluster frame;
  `sendAgentCommand` sends nothing without a cluster id, so neither do the
  commands built on it. The agent client already started only in a cluster
  frame; a test checks that the root window has no chat and sends nothing.
  The stub's `Renderer.Catalog.getActiveCluster` went with its last user.
  Upstream: none.

## Upstream work items

- freelensapp/freelens: none. The two gaps the `main` branch found for this
  code, `navigateToPreferences()` and the removed `openExternal`, are
  documented at the pin ("Node and Electron in the renderer" and
  "openExternal, openBrowser" in the guide).
- pi: a runtime-level `fetch` option (F2). Not filed yet; the maintainer files
  it and links it in the F2 finding. Proposed text:

  > **Title:** A `fetch` option for everything a `ModelRuntime` and its
  > sessions send over HTTP
  >
  > pi runs inside an Electron app (Freelens) whose main process has its own
  > HTTP client: a `fetch` that applies the user's HTTPS proxy and custom CA
  > certificates. Node's global `fetch` applies neither, so behind a
  > corporate proxy pi fails where the app works. Replacing the global `fetch`
  > or undici's global dispatcher is not an option inside a host process.
  >
  > Today the only way in is to wrap `session.agent.streamFunction` and add
  > `fetch` to each request's options. That covers model requests, compaction
  > and the cache warmer, but not:
  >
  > - OAuth logins and token refreshes (`auth/oauth/*`), which call the
  >   global `fetch`;
  > - model-list refreshes (for example `providers/openrouter.js`);
  > - the Google Generative AI and Google Vertex adapters, which throw
  >   "Custom fetch is not supported" for any `fetch` but `globalThis.fetch`;
  > - Bedrock (the AWS SDK's Node handler) and the Codex WebSocket transport,
  >   which take a proxy only from `HTTPS_PROXY`/`HTTP_PROXY`.
  >
  > Request: a `fetch` option on `ModelRuntime.create()` (or on
  > `createAgentSession()`), used by default for every request the runtime and
  > its sessions make, OAuth flows and model listing included; and, where an
  > SDK cannot take a `fetch`, a documented hook for the HTTP agent or
  > dispatcher instead of the environment variables only.
- pi: an entry point for its message, event and session-stats types that does
  not reach Node's types, so that browser code (here the renderer and common
  programs) can import them instead of declaring them (step 3).
- freelensapp/freelens: expose the status of a failed request on the error
  the JSON client rejects with (`JsonApiErrorParsed` keeps the Kubernetes
  `Status` private and is not exported), so that an extension can tell a 404
  from another failure without parsing the message (09).
- freelensapp/freelens-example-extension: a script for the checks of the
  built output, such as `build/check-built-output.mjs` (step 2); the template
  and its ports run them by hand.
