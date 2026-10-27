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
- [ ] **F1. Read tools in main (09), write tools and the backup in main (10).**
- [ ] **F2. Model requests through the Freelens HTTP client (11).**
- [ ] **Step 7. AGENTS.md and README (12).**
- [ ] **Manual test cases for Freelens v2 (13).**
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
      Google providers
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

## Upstream work items

- freelensapp/freelens: none. The two gaps the `main` branch found for this
  code, `navigateToPreferences()` and the removed `openExternal`, are
  documented at the pin ("Node and Electron in the renderer" and
  "openExternal, openBrowser" in the guide).
- pi: a session-level `fetch` option, so that OAuth logins and model-list
  refreshes can use the host's client too (ticket 11 files it).
- pi: an entry point for its message, event and session-stats types that does
  not reach Node's types, so that browser code (here the renderer and common
  programs) can import them instead of declaring them (step 3).
- freelensapp/freelens-example-extension: a script for the checks of the
  built output, such as `build/check-built-output.mjs` (step 2); the template
  and its ports run them by hand.
