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
- [ ] **Step 2. Vite build (04).**
- [ ] **Step 3. TypeScript layout and environment tests (05).**
- [ ] **Step 4. Source migration (06).**
- [ ] **Step 5. Unit tests on Vitest 5, tree green again (07).** Steps 1 to 5
      are pushed here.
- [ ] **Step 6. Tooling and CI from the `main` branch (08).**
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
output:

- [ ] `dist/main.js` loads in plain Node with a stand-in
      `globalThis.FreelensExtensionApi`, and its default export is the
      extension class
- [ ] no `global.` host reference in either bundle; no `require(` in the
      renderer bundle, and in the main bundle only Rolldown's `__require`
- [ ] no bare import of a host module (`react`, `react-dom`,
      `react/jsx-runtime`, `mobx`, `mobx-react`, `monaco-editor`) and no second
      copy of React or mobx
- [ ] no Node builtin in the renderer bundle
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

## Upstream work items

- freelensapp/freelens: none. The two gaps the `main` branch found for this
  code, `navigateToPreferences()` and the removed `openExternal`, are
  documented at the pin ("Node and Electron in the renderer" and
  "openExternal, openBrowser" in the guide).
- pi: a session-level `fetch` option, so that OAuth logins and model-list
  refreshes can use the host's client too (ticket 11 files it).
- freelensapp/freelens-example-extension: none yet.
