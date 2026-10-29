# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

> **Tip**: If you find yourself correcting the agent during interactive work, suggest adding a new rule to this file so the lesson is captured for future sessions.

## Project Overview

Freelens AI (`@freelensapp/ai-extension`) is an extension of the Freelens v2
extension API that adds an AI chat to every cluster: LangGraph agents that
read and, with the user's approval, change Kubernetes resources, an MCP agent
for the user's MCP servers, an "Explain" item on warning Events, and a
preferences page for the model, its key and the agents. It is built on the
patterns of freelensapp/freelens-example-extension, the template of the
Freelens extension docs.

- **Language**: TypeScript 7.0.2
- **Runtime**: Freelens >= 2.0.0 (extension API v2)
- **Toolchain**: Node.js 24.x, yq 4.x and cosign 3.x (`mise.toml` with
  `mise.lock`; Node also in `.nvmrc`)
- **Package manager**: pnpm 12.x (`packageManager`, run through corepack)
- **License**: MIT

Library and tool versions follow the Freelens stack: the libraries the
extension shares with Freelens (`react`, `mobx`, `mobx-react`,
`monaco-editor`, `typescript`, `vite`, `vitest`, `electron`, `zod`, ...) are
pinned to the versions of the Freelens `pnpm-workspace.yaml` catalog at the
commit the pinned release of `@freelensapp/extensions` was built from; the tools
run with `pnpm dlx` (Biome, knip, the Trunk launcher) to the root
`package.json` scripts of Freelens; Node and the other mise tools to Freelens's
`mise.toml` and `.nvmrc`. Renovate keeps them there: custom datasources in
`.renovaterc.json` read the versions from the same Freelens files on `main`,
so an update arrives only once Freelens has adopted it, at that version, in
one "Freelens dependencies" group together with a release of
`@freelensapp/extensions`. A bundled library
that Freelens does not have is excluded from the catalog rule and updated as
usual (see "Modules provided by the host"). After changing `mise.toml`, run `mise lock`, which re-locks every
platform, not only `mise install`.

pnpm settings live in `pnpm-workspace.yaml`. A dependency runs its install
scripts only when `allowBuilds` sets it to `true`, and a new dependency with
install scripts that is not listed there fails `pnpm install`, so add it with
`true` or `false` deliberately. `@freelensapp/extensions` is excluded from
`minimumReleaseAge`, because a Freelens release is adopted on the day it is
published, together with the stack it was built with. `strictPeerDependencies: true` makes `pnpm install` fail when
the extension's own copy of a library it shares with the host (`react`,
`react-dom`, their types, `mobx`, `mobx-react`, `monaco-editor`, `electron`)
is outside the peer range `@freelensapp/extensions` declares for it; without
it pnpm prints one warning line and installs anyway, and these peers are the
only place where the extension's copies are compared with the versions the
host runs. `monaco-editor` is declared, without being imported, because the
`options` of `Renderer.Component.MonacoEditor` take their types from it; without
it they are `any`, and `skipLibCheck` hides the unresolved import.

## Common Commands

```bash
# Type checking
pnpm type:check                # All of the programs below, in this order
pnpm type:check:sources        # main and renderer, each with src/common/
pnpm type:check:tests          # Tests and test support
pnpm type:check:tooling        # Vite and Vitest configs, build plugins
pnpm type:check:integration    # Integration tests
pnpm type:check:environments   # Environment tests

# Linting & formatting
pnpm biome:check          # TypeScript/TSX, JS, JSON, CSS, SCSS, HTML, YAML, Markdown (biome)
pnpm biome:fix            # Auto-fix the formats above
pnpm trunk:check          # TOML, shell, workflows, yamllint, and Biome again (modified files)
pnpm trunk:check:all      # The same over every file, as trunk-check.yaml runs it
pnpm trunk:fix            # Auto-fix TOML, shell, and the Biome formats
pnpm lint:check           # biome check (all biome formats)
pnpm lint:fix             # biome fix (all biome formats)
pnpm knip:check           # Unused files and dependencies; run after `pnpm build`

# Tests
pnpm test:unit            # vitest
pnpm test:integration     # vitest, against Freelens dev with a kind cluster

# Build
pnpm build                # Renderer and main bundles in dist/ (no type check)
pnpm dev                  # The same two builds in watch mode, for a directory install

# Pack for testing
pnpm pack:dev             # Bump prerelease version, build, and create .tgz for install in Freelens app

# Clean
pnpm clean                # Clean dist/
pnpm clean:dts            # Remove the *.d.scss.ts declarations; the next renderer build writes them again
pnpm clean:all            # Clean everything (dist, dts, node_modules, tgz)
```

## Architecture

```text
src/
  main/index.ts                  # Extension entry point (main process, ESM): stores, bridge lifecycle
  main/agents/                   # LangGraph agents, approval gate, compaction, Explain, AgentRuntime
  main/agents/tools/             # Kubernetes tools, by path through KubeJsonApi.forCluster
  main/bridge/                   # Local HTTP/SSE bridge server and its routes
  main/mcp/                      # MCP servers of the preferences, one client per cluster
  main/provider/                 # Chat models, prompts, model pricing
  main/utils/                    # Logger of main
  renderer/index.tsx             # Extension entry point (renderer process, ESM): pages, menus, preferences
  renderer/business/bridge/      # Client of the bridge (the global fetch)
  renderer/business/service/     # Chat service: runs, approvals and their events, as the views use them
  renderer/business/cluster/     # Id of the active cluster of the frame
  renderer/components/, pages/   # Views: chat, messages, approvals, preferences, error boundary
  renderer/context/              # Application context of a cluster frame
  renderer/navigation/           # Id of the chat page
  renderer/icons/, utils/        # The sidebar icon; the useLog hook of the views
  common/bridge/                 # Bridge protocol (routes, bodies, events) and the SSE codec
  common/store/                  # ExtensionStores shared by both processes
  common/provider/, service/     # Pure model, pricing, token and compaction helpers
  common/agent/, objects/        # Checkpoint namespaces; the chat message objects
  common/utils/                  # Logger factory, redaction, ids
test/                            # Test stub of @freelensapp/extensions and test support
environment-tests/               # Probes that prove the per-environment type check (see "TypeScript")
integration/__tests__/           # Integration tests, run against Freelens dev over CDP (see "Integration tests")
integration/fixtures/            # Test objects of the integration tests: a namespace and a Warning event
build/                           # Vite plugins: host modules, standard decorators, CSS module declarations
```

Build output goes to `dist/`: `dist/main.js`, `dist/renderer.js` and
`dist/renderer.css`, the entries `package.json` names.

The extension presents no custom resource and has no `KubeObject` model of its
own: the agents reach every kind by path from main (see "Runs and their
cluster"), and the views use the host's `KubeEvent` only. So
`customResources` of the renderer extension is not set.

## Renderer Components

- **Registrations.** `src/renderer/index.tsx` registers the chat page
  (`clusterPages`), its sidebar entry (`clusterPageMenus`), the "Explain" item
  of the Event menu (`kubeObjectMenuItems`) and the preferences
  (`appPreferences`). The "Explain" item is built with
  `Renderer.K8sApi.menuItemFor(Renderer.K8sApi.KubeEvent, { MenuItem })`, and
  its props extend `Common.Types.KubeObjectMenuItemProps<KubeEvent>`. The page
  id is `MAIN_PAGE_ID` of `src/renderer/navigation/pages.ts`, used wherever the
  page is named.
- **Error boundary.** `clusterPages`, `kubeObjectMenuItems` and
  `appPreferences` are mapped through `withPageErrorBoundary`,
  `withMenuItemErrorBoundary` and `withPreferenceErrorBoundary` of
  `src/renderer/components/error-boundary.tsx`, so that an entry added to them
  is wrapped too. An error a page or a preference `Input` throws shows the
  error page in its place; one a menu item or a preference `Hint` throws leaves
  it out. Either is logged with `Common.logger` and the extension's name. The
  host has no boundary around a menu item or an extension's preferences, and
  its boundary around a frame would replace the whole cluster view or
  preferences page.
- **Preferences.** `src/renderer/pages/preferences/preferences-page.tsx` is
  the `Input` of the one `appPreferences` entry, an `observer` that writes
  `PreferencesStore` directly; text areas commit on blur. It is styled by its
  CSS module, and its controls follow the theme through the host's variables
  (`--inputControlBackground`, `--inputControlBorder`,
  `--inputControlHoverBorder`, `--textColorPrimary`), never hard-coded colours.
  The host's `Switch` renders only its `children` in its label and passes
  every other prop, `className` and `style` included, to the checkbox.
- **Navigation.** A registration hands the extension instance to its view
  (`<MainPage extension={this} />`, `<MenuEntry {...props} extension={this} />`),
  never through module state. A view opens the chat page with
  `extension.navigate(MAIN_PAGE_ID)` and the extension's preferences with
  `extension.navigateToPreferences()`, which the chat reaches through
  `navigateToPreferences` of the application context. The chat runs in the
  cluster frame and the preferences live in the root frame:
  `navigateToPreferences()` reaches the root frame, which
  `Renderer.Navigation.navigate` does not, and no route is written by hand.
- **Host components** come from `Renderer.Component`, destructured at module
  level (`Button`, `Select`, `MonacoEditor`, `MenuItem`, `Icon`, ...). The
  option of a single-value `Select` is `Renderer.Component.SelectOption<T> | null`
  in its `onChange`, rather than `SingleValue` of `react-select`.
- **Observers.** A view that reads a store is wrapped in `observer` of
  `mobx-react`, the host's instance.
- **Props passed to the DOM.** A list child has a `key`. A component that
  renders an element with props it was handed passes only DOM attributes:
  react-markdown hands a custom renderer the syntax tree's `node` next to the
  element's attributes, so `markdown-viewer.tsx` takes it out. React reports
  either mistake in DevTools, and the view tests expect no `console.error`
  (see "Tests and tooling").
- **Markdown code.** react-markdown does not tell a `code` renderer whether
  the code is inline. A fenced block is a `code` inside a `pre`, so the `pre`
  renderer of `markdown-viewer.tsx` marks its content with a context, and the
  `code` renderer shows a block in the editor and anything else inline; a
  guess from the language class or a newline would take a one-line block
  without a language for inline code. The renderers are defined at module
  level: a renderer created in the render is a new component type each time,
  and React would remount every code block, editor included, on each update.
- A component's stylesheet is a CSS module next to it, `x.module.scss`, imported as `import styles from "./x.module.scss"` and used as `className={styles.someClass}`; there is no `?inline` import and no `<style>` element. The host's own classes and theme markers are matched with `:global(...)`, for example `:global(body.theme-light) .x` and `.x :global(.Select__single-value)`, since every other class name in a module is scoped.
- CSS modules get TypeScript declarations (`*.module.d.scss.ts`) from `build/vite-plugin-css-module-declarations.mjs`, written by the renderer build (see "CSS module declarations" under "Build").

## Rules That Fail Silently

Each of these compiles when it is broken, and breaks the extension at runtime
or not visibly at all. The sections named in parentheses explain the
mechanism; this is the list to check a change against.

- **The host's React and mobx, one copy each.** Import `react`, `react-dom`,
  `mobx` and `mobx-react` by their bare module ids. A second React throws
  `invalid hook call`; a second mobx throws nothing, and the host never reacts
  to its observables. The build fails on the ways a second copy gets in
  ("Modules provided by the host").
- **The stores keep the annotation map.** An observable field of a store is a
  plain field listed in `makeObservable(this, { field: observable })` after
  `super()`. A decorator on a plain field type-checks and leaves the field
  unobservable in mobx's production build; an `@observable accessor` field
  moves the value behind a getter, which `toJSON()`, `toJS()` and spreading do
  not see ("Decorators and the stores").
- **A memo over a store's items is keyed on something that changes with
  them.** The host keeps one observable array per store and updates it in
  place, with `replace` and `splice`, so `store.items` stays the same array
  while the objects in it change. A `useMemo` keyed on it, or on a prop that
  holds it, is computed once, and an open view keeps the objects it was opened
  with. An `observer` that reads the items while it renders follows them; a
  memo needs a key such as the ids and `resourceVersion`s of the objects. It
  shows only on a cluster whose objects change while the view is open.
- **An effect creates what its cleanup aborts or releases.** Freelens dev
  renders in `React.StrictMode`, which runs an effect, cleans it up and runs
  it again on the same instance. An `AbortController` kept in a `useRef` is
  aborted by the first cleanup, and every request of the second run with it:
  a bridge request or a run's event stream that is aborted for no failure
  ends at once, and the view shows nothing. Create the controller, and
  whatever else the cleanup releases, inside the effect. The production build
  has no `StrictMode`, so only Freelens dev shows it.
- **No Node or Electron in renderer and common code.** They are `undefined` in
  the renderer. The build fails on an import, `pnpm type:check` on a global
  ("Process-specific settings").
- **Main is built for the `node` platform.** On the `browser` platform a
  bundled CommonJS package's `require()` of a builtin throws only when
  Freelens evaluates `dist/main.js`; the build and the type check pass
  ("Process-specific settings").
- **One CSS asset, `dist/renderer.css`.** Any other name, or a second asset,
  leaves the extension unstyled. Nothing checks it; look at `dist/` after a
  change to the CSS setup ("CSS").
- **One tsconfig per environment.** Each program has only its runtime's `lib`
  and `types`, and no declaration may load Node into the renderer or the DOM
  into main; otherwise a wrong API type-checks and is `undefined` at runtime.
  The environment tests fail on a leak ("TypeScript").
- **The agents and LangChain in main only.** In the renderer `interrupt()`
  throws, `ToolNode` hands the error to the model as the tool's result, and a
  write is neither applied nor asked about ("Agents and the Bridge").
- **The cluster from the run config.** A tool reads its cluster from
  `configurable.clusterId`, never from module state: two cluster frames run
  at once, and a module-level cluster sends one chat's request to the other's
  cluster ("Runs and their cluster").
- **HTTP from main through `Main.Util.fetch`.** The global `fetch`, or a
  bundled client's default one, works too, but ignores the user's proxy and
  certificate preferences ("HTTP from main").
- **Nothing in module state that `onDeactivate` cannot reach.** A server, a
  timer, a run or an MCP process kept there survives a reload, and the next
  `onActivate` starts a second one ("Lifecycle").
- **Every page, menu item and preference inside an error boundary.** The host
  has none around a menu item or an extension's preferences, and its boundary
  around a frame replaces the whole cluster view or preferences page. Map the
  registrations through their wrappers in `error-boundary.tsx` ("Renderer
  Components").
- **A view gets the extension from its registration.** The host passes a
  cluster page `params` only. The type check rejects a page that requires
  another prop, but not one that declares it optional; and only the
  extension's `navigateToPreferences()` reaches the preferences from a cluster
  frame ("Renderer Components").
- **An ESM `main`, and the entries in `package.json` unchanged while
  `pnpm dev` runs.** The host refuses to reload a CommonJS main and logs why,
  and it watches only the entries it started with, so a manifest change needs
  Freelens restarted.
- **A bundled CommonJS package loads in the ESM main.** Main is built for
  Rolldown's `node` platform, which gives it a `require`, and defines
  `__dirname` and `__filename`. Without either, the package throws when
  Freelens evaluates `dist/main.js`, and the extension does not activate;
  `pnpm build` and `pnpm type:check` pass ("Process-specific settings").

Neither `pnpm build` nor `pnpm dev` runs the type check, so a Node global in
renderer code passes them; `pnpm type:check` and `type-check.yaml` catch it.

## Build

`vite.config.mjs` builds one entry point per run, in library mode, as ESM:
`vite build` builds the renderer and empties `dist/`, and `vite build --mode
main` builds main next to it. The two runs share no chunk; each bundle carries
its own copy of the `src/common/` code it imports. Nothing is minified.

`pnpm dev` runs the same two builds in watch mode, side by side, for a
directory install: the host reloads the extension when either entry is
rewritten. Its renderer run passes `--no-emptyOutDir`. In watch mode Vite
empties the output directory again before every rebuild, so a renderer rebuild
would delete `dist/main.js`, and the host would have no main entry to reload.

`vite.config.mjs` and the plugins in `build/` are the template's
(freelensapp/freelens-example-extension), and
`build/vite-plugin-standard-decorators.mjs` is Freelens's own.

### Modules provided by the host

The host publishes its singletons on `globalThis.FreelensExtensionApi`, and
each process publishes only the ones it has. This is contract C3 of the
Freelens extension API (`docs/extensions/api.md`):

| Module id           | Global            | Published in |
| ------------------- | ----------------- | ------------ |
| `react`             | `React`           | renderer     |
| `react-dom`         | `ReactDom`        | renderer     |
| `react/jsx-runtime` | `ReactJsxRuntime` | renderer     |
| `mobx`              | `Mobx`            | both         |
| `mobx-react`        | `MobxReact`       | renderer     |
| `monaco-editor`     | `MonacoEditor`    | renderer     |

`build/vite-plugin-host-modules.mjs` replaces a bare import of one of these
with a module that reads the global, in the extension's code and in every
library it bundles (`lucide-react` and `react-markdown` import `react` too). Its named exports are the members of the copy installed as a
devDependency, which is pinned to the host's version, so an import of a name
the host's version lacks fails the build. The plugin also fails the build on an
import of a host module that the process does not publish (`react` in main),
and on a subpath of a host package that the host does not publish
(`react-dom/client`, `react/jsx-dev-runtime`). Both would otherwise either read
`undefined` at runtime or bundle a second copy. A second React throws
`invalid hook call`; a second mobx throws nothing, and the host simply never
reacts to its observables.

Everything else is bundled, the LangChain and MCP libraries included. That
includes `@freelensapp/extensions`, a shim of three lines that reads `Common`,
`Main` and `Renderer` off the same global; it must not be mapped. The host
installs no dependencies of an extension, so whatever the code needs at
runtime and the host does not provide has to be in the bundle.

Every library is a devDependency, bundled or not. A bundled library that
Freelens does not have in its catalog is named in two more places: in
`ignoreDependencies` of `knip.jsonc`, since the `--production --strict` pass
reports a devDependency imported by production code as unlisted, and as an
exclusion (`!name`) in the "Freelens dependencies" rule of `.renovaterc.json`,
since that rule takes every other version from the Freelens catalog.

### Process-specific settings

- **Renderer**: nothing is external. Renderer code gets no Node or Electron, and
  an import of a Node builtin or of `electron`, in the extension or in a
  bundled library, fails the build (Vite would otherwise replace it with an
  empty module and only warn). `process.env.NODE_ENV` is replaced at build
  time, because library mode leaves it for a consumer's bundler and the page
  has no `process`.
- **Main**: Node builtins (`node:*` and bare) and `electron` stay external.
  Bundled packages resolve with Vite's server conditions, so main gets their
  Node builds rather than their browser builds. Main is built for Rolldown's
  `node` platform (`build.rolldownOptions.platform`), the renderer for
  `browser`, the default of a Vite client build. A bundled CommonJS package
  `require()`s the builtins, and an ES module has no `require`: for the
  `browser` platform Rolldown turns the call into a `__require` shim that
  throws ``Calling `require` for "node:assert" in an environment that doesn't
  expose the `require` function`` as soon as the bundle is evaluated, and for
  `node` it defines `__require` with `createRequire(import.meta.url)`.
  `__dirname` and `__filename` are the other half: Node passes them to a
  CommonJS module, Rolldown leaves them as they are on either platform, and
  the ES module throws `ReferenceError: __dirname is not defined in ES module
  scope`. Main defines them (`define`) as `import.meta.dirname` and
  `import.meta.filename`, the directory and file of `dist/main.js`, not of the
  package: a library that loads a file next to itself, such as a `.wasm`,
  finds it only when the build puts it in `dist/`.
  `pnpm build` and `pnpm type:check` pass either way, and nothing before
  Freelens evaluates `dist/main.js`, so on the wrong platform the extension
  fails only when Freelens loads it.

### Decorators and the stores

The extension has no decorator. Its stores (`src/common/store/`) extend
`Common.Store.ExtensionStore`, which the host persists and syncs between the
processes through `toJSON()` and `fromStore()`. Their fields are plain own
fields, made observable by an annotation map in the constructor,
`makeObservable(this, { field: observable, ... })` after `super()`, which runs
after the field initializers under `useDefineForClassFields`. `toJSON()` reads
the fields as they are and converts an observable array with `toJS()`, since
the host structure-clones the value and a mobx proxy cannot be cloned.
`@observable accessor` fields would move the values to getters on the
prototype, and a decorator on a plain field type-checks but leaves the field
unobservable in mobx's production build.

The build still lowers a decorator, should one be added: MobX 7 supports
standard decorators only, and Oxc, which transpiles TypeScript for Vite, passes
them through unlowered, while neither Node nor Chromium runs them yet.
`build/vite-plugin-standard-decorators.mjs`, which Vitest uses too, hands every
module with a decorator to esbuild first, which lowers the decorators and their
`accessor` fields. A decorator that reaches the host unlowered is a syntax
error when the module is evaluated.

### CSS

The host links the stylesheet named after the renderer entry, `renderer.css`
next to `renderer.js`. Library mode extracts the CSS of the whole bundle into
that one file (`build.lib.cssFileName`). A build that emits more than one CSS
asset, or a differently named one, leaves the extension unstyled. CSS modules
use `camelCaseOnly` class names.

### CSS module declarations

`build/vite-plugin-css-module-declarations.mjs` writes `x.module.d.scss.ts`
next to every `x.module.scss` the renderer build imports, in `vite build` and
in watch mode. It takes the class names from Vite's own `preprocessCSS`, with
the build's resolved config, so they are the names the bundle exports, after
`localsConvention`; a class inside `:global(...)` is not one of them. The
declarations are committed, because the type check runs without a build.

The plugin is written so that a build cannot leave a committed declaration
empty or partial, whether it fails, is interrupted or is killed: it awaits its
work in `transform`, writes a declaration only when the content changed, and
writes to a temporary `*.tmp` file that it renames over the declaration.

## TypeScript

Main code runs in Node, renderer code in a browser page, and common code in
both. Each is type-checked in a program of its own, so that an API the runtime
does not have fails `pnpm type:check` rather than the extension:

| Config                       | lib                       | types                             | Files                                                                                              |
| ---------------------------- | ------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/main/tsconfig.json`     | ES2024                    | `node`                            | `src/main/`, `src/common/`                                                                         |
| `src/renderer/tsconfig.json` | ES2024, DOM, DOM.Iterable | `vite/client`                     | `src/renderer/`, `src/common/`                                                                     |
| `src/common/tsconfig.json`   | ES2024, WebWorker         | none                              | `src/common/`                                                                                      |
| `src/tsconfig.json`          | ES2024, DOM, DOM.Iterable | `node`, `vite/client`             | `*.test.ts(x)` under `src/`, and `test/`                                                           |
| `integration/tsconfig.json`  | ES2024, DOM, DOM.Iterable | `node`, `@freelensapp/extensions` | `integration/`                                                                                     |
| `tsconfig.json`              | ES2024                    | `node`                            | `vite.config.mjs`, `vitest.config.ts`, `vitest.integration.config.ts`, `svgo.config.mjs`, `build/` |

All of them extend `tsconfig.base.json`, which has the compiler options of
Freelens's fixture extension: `strict`, `moduleResolution: Bundler`,
`useDefineForClassFields`, `noUncheckedSideEffectImports` and `skipLibCheck`
among them. `skipLibCheck` is required: `extension-api.d.ts` is one declaration
for both processes and names DOM types and the `Electron` namespace, which no
single program has. Write `types` in every config; it decides which `@types`
packages a program sees.

### Main, renderer and common

The main and renderer configs both include `src/common/`. Compiled as main,
common code fails on the DOM; compiled as renderer, it fails on Node. What
passes both is valid in both, and that is the check that decides. Common code
uses only what both runtimes have: `globalThis.crypto`, `TextEncoder` and
`TextDecoder`, `URL` and `URLSearchParams`, `AbortController`,
`structuredClone`, and the timers, with the timer handle kept opaque. It
imports nothing from `src/main/` or `src/renderer/`: a module that both
processes need lives in `src/common/`, and whatever imports React, the DOM or
Node stays in the process that has it.

`src/common/tsconfig.json` is for the editor, which gives a file to one config
only. Its `WebWorker` lib is the closest single match and an approximation:
`self` and `postMessage` compile there and fail in the main program.

The common program is not compiled on its own. `environment-tests/tsconfig.json`
extends `src/common/tsconfig.json` and keeps its `include`, so
`tsc -p environment-tests`, in `pnpm type:check:environments`, compiles
`src/common/` with the common settings, together with the probes.

The split does not cover the API namespaces: `Main` and `Renderer` compile in
every program, and the one the process does not have is `undefined` at runtime.
Common code uses `Common`.

### Asset imports

The renderer program has `vite/client`, which declares `*?raw`, `*?inline` and
the CSS modules and brings no Node into the program. With
`allowArbitraryExtensions`, `import styles from "./x.module.scss"` resolves to
the generated `x.module.d.scss.ts`, so a class name that the stylesheet lacks
fails the check. Without that file, after `pnpm clean:dts`, the import falls
back to the untyped declaration of `vite/client`.

### Environment tests

`types` and `lib` alone do not keep an environment pure. A declaration file
with `/// <reference types="node" />` loads all of `@types/node` into any
program that reaches it, whatever `types` says, and one with
`/// <reference lib="dom" />` loads the DOM. `environment-tests/` proves the
split holds:

| File             | Compiled with          | Must                      |
| ---------------- | ---------------------- | ------------------------- |
| `node-apis.ts`   | renderer, common       | fail on every marked line |
| `dom-apis.ts`    | main, common           | fail on every marked line |
| `worker-apis.ts` | main                   | fail on every marked line |
| `shared-apis.ts` | main, renderer, common | pass                      |

Each line that must fail carries `// @ts-expect-error`, so a program that
starts accepting it fails with an unused directive. The configs there extend
the source configs and keep their `include`, so the probes are compiled
together with the sources and every declaration the sources reach. Compiled
alone, they would not see a declaration that a dependency of the sources brings
in.

When a declaration leaks, the environment tests fail; keep the leak out rather
than relax a probe. For Node in the renderer, point `typeRoots` of the renderer
config at a directory with an empty `node` package, which a reference directive
resolves to first. For the DOM in main, remove the directive from the
declaration with `pnpm patch`. The bundled libraries of this extension
(LangChain, the MCP SDK, `react-markdown`) leak neither today.

### Tests and tooling

Tests are not in the environment programs. Vitest runs them in Node, so
`src/tsconfig.json` gives them the DOM and Node. It sits in `src/` so that an
editor finds it for a test file: the environment config next to the test
excludes it, and the editor goes on to the next `tsconfig.json` up the tree.
Tests compile against the real `@freelensapp/extensions` declaration.

No config declares the Vitest globals. TypeScript has no per-file globals, so
declaring `describe` or `vi` for tests would declare them for every file in the
program. Test and test-support files import what they use:

```ts
import { describe, expect, it, vi } from "vitest";
```

The module resolves from every program, so Biome keeps it out of the
extension's code: `style/noRestrictedImports` rejects `vitest` everywhere
except `src/**/*.test.*`, `test/` and `integration/`. The same rule rejects
there the testing helpers of React: the `act` named import of `react`,
`react-dom/test-utils` and `@testing-library/*`. They type-check, build and
pass the unit tests, which run the development build of React, but `act`
delegates to `React.act`, which the production build that Freelens runs leaves
out, so the call throws only in the host. At runtime
`vitest.config.ts` still sets `globals: true`, because React Testing Library
registers its automatic cleanup only when `afterEach` is a global.

`vitest.config.ts` uses the build's plugins (the standard decorators and
React), runs tests in Node, and a test that renders a component opts into jsdom
with a `// @vitest-environment jsdom` comment and renders it with React Testing
Library (`@testing-library/react`). React reports a list child without a key or
an attribute the DOM does not take with `console.error`, so a view test spies
on it and expects no call.

The shim of `@freelensapp/extensions` reads the host's global when it is
loaded, so it throws under Vitest. `vitest.config.ts` aliases the package to
`test/freelens-extensions.ts`, a stub of the runtime surface the tests reach:
an in-memory `Common.Store.ExtensionStore` (a singleton per class, with
`resetInstance()` between tests), an empty `Main.LensExtension`, whose
lifecycle methods a test calls itself, `vi.fn()` stand-ins for
`Common.logger`, `Main.Catalog.getClusterById`,
`Main.K8sApi.KubeJsonApi.forCluster`, `Main.Shell.getEnvironment`,
`Main.Util.fetch`, `Renderer.Catalog.getActiveCluster` and the terminal of
`Renderer.Component`, and plain DOM stand-ins for the host components the views
render (`Button`, `Icon`, `Input`, `Switch`, `HorizontalLine`, `MonacoEditor`,
which shows its value as text, and `Select`, a button per option and one that
clears it with `null`). Extend it
when a test needs
more of the host; it is runtime only, the types stay the real declaration's.
knip does not follow the alias, so the stub is an entry of `knip.jsonc`.

`test/kube-json-api.ts` is a stand-in `KubeJsonApi` for the Kubernetes tools:
it answers a GET from a map of paths (the discovery documents included),
records every request, and `installFakeClusters()` hands one per cluster id to
the stubbed `forCluster`. The tool tests assert on the recorded requests. The
approval gate runs inside a real LangGraph graph in `agent-service.test.ts`,
since `interrupt()` needs one; elsewhere `@langchain/langgraph` is mocked so
that `interrupt()` answers at once. The bridge is tested over plain HTTP on an
ephemeral port. `McpClients` takes its host calls as dependencies, which the
tests replace; one test starts `test/fixtures/environment-mcp-server.mjs`, a
minimal stdio MCP server, with `process.execPath`, to see the environment a
server gets and that closing the client ends its process.

The root `tsconfig.json` checks the tooling files. It has `checkJs`, so the
Vite config and the build plugins are type-checked too; give their function
parameters JSDoc types.

## Lint and CI

### Biome

`biome.jsonc` has the formatter, import groups and rules of Freelens. Two
overrides are specific to how the extension is laid out:

- `style/noRestrictedImports` keeps `vitest` and the testing helpers of React
  out of the extension's code (see "Tests and tooling").
- `correctness/noNodejsModules` rejects a Node builtin import in
  `src/renderer/` and `src/common/`, tests left out. It flags the import in the
  editor, before the build does; it does not see Node globals such as `Buffer`
  or `process`, which only the type check catches.

Every path in an override starts with `**/`. Trunk runs Biome from a sandbox
outside the repository, with `--config-path` pointing back at `biome.jsonc`,
and there a path anchored at the repository root matches no file, so the
override silently does nothing. A plain `biome check` matches both forms, so
only `trunk check` shows the difference. In that sandbox Biome also cannot
apply `vcs.useIgnoreFile`, so the Biome commands in `.trunk/trunk.yaml` pass
`--vcs-use-ignore-file=false`; Trunk applies `.gitignore` itself before it
picks the targets.

Renovate updates Biome, in the `biome` script and in `.trunk/trunk.yaml`, but
cannot run `biome migrate`. `biome-migrate.yaml` runs it on the Renovate
branch and commits the migrated `biome.jsonc` there, so that the update and its
migration are one pull request. The commit is by `github-actions[bot]`, which
`gitIgnoredAuthors` in `.renovaterc.json` lists, so that Renovate does not take
it for a manual edit and stop updating the branch.

Biome formats SCSS, YAML and Markdown too, as in Freelens, so Trunk runs no
Prettier, markdownlint or yamlfmt; yamllint still checks YAML. `biome.jsonc`
leaves out `pnpm-lock.yaml` and `pnpm-workspace.yaml`, which pnpm writes, and
`.trunk/`, whose `trunk.yaml` `trunk upgrade` rewrites. The Markdown rules are
in `nursery`. Trunk takes actionlint from the maintained fork of kjanat, which
continues the releases of rhysd/actionlint with the same file names.

### Knip

`pnpm knip:check` runs knip twice, for unused files and for dependencies: a
development pass over everything, and a `--production --strict` pass over the
code that reaches the bundles, which are the entries marked with `!` in
`knip.jsonc`. In the production pass a devDependency imported by production
code is reported as unlisted, so the host-provided modules and the bundled
libraries are listed in `ignoreDependencies` (see "Modules provided by the
host"). A file is unused when no entry reaches it; the production pass also
reports a module that only tests import. The fix is to remove the file, not to
ignore it. Unused exports are not checked.

`knip.jsonc` lists the entries knip cannot find: the two source entries, the
Vitest alias target `test/freelens-extensions.ts` and the probes in
`environment-tests/`. Its Vite plugin is off: it adds the renderer entry of
`vite.config.mjs` as a development entry, which displaces
`src/renderer/index.tsx!`, and the production pass then skips the renderer.
`project` leaves out the CSS module declarations (`!src/**/*.d.scss.ts`),
which knip, resolving `import styles from "./x.module.scss"` to the
stylesheet, would report as unused. `ignore` leaves out `dist/**`: the `main`
field makes `dist/main.js` an entry once it exists, and with `--no-gitignore`
knip would report what the bundle inlines from its libraries. Run
`pnpm knip:check` after a build when changing `knip.jsonc`, as `check.yaml`
does; without `dist/` that problem does not show.

### Workflows

| Workflow                 | Runs                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| `type-check.yaml`        | `pnpm type:check`                                                             |
| `check.yaml`             | `pnpm build`, `pnpm lint:check`, `pnpm knip:check`                            |
| `unit-tests.yaml`        | `pnpm test:unit`                                                              |
| `trunk-check.yaml`       | `trunk check` over every file (`check-mode: all`)                             |
| `integration-tests.yaml` | the integration tests in `integration/`, against Freelens dev v2.0.0          |
| `mise-lock-check.yaml`   | on a change to `mise.lock`: no checksum changed for an unchanged tool version |
| `release.yaml`           | on a tag: build, pack, publish to npm, the release with `.tgz` and `.sha256`  |

The type check has a workflow of its own, on pull requests and on pushes to
`main`, as in Freelens. It runs every program, tests, tooling and environment
tests included, which no build reaches, and a type error shows as its own
failed check rather than as a failed build. `check.yaml` builds without the
type check for the same reason, so it does not run twice. `pnpm trunk:check`
checks only modified files, so run `pnpm trunk:check:all` before pushing, as
the workflow does.

### Integration tests

The integration tests follow the pattern of freelensapp/freelens-example-extension.
They run in this repository, under its own Vitest
(`vitest.integration.config.ts`, `pnpm test:integration`), against Freelens
started with `pnpm dev` from a freelensapp/freelens checkout. They attach to
it with Playwright's `chromium.connectOverCDP` on the port that script opens
(see "Checking the Extension in Freelens Dev"), so they need no package of
Freelens and no file of its checkout; Freelens dev is the only dependency, and
it is not in `package.json`. `playwright` is a devDependency at the version of
Freelens's catalog. The workflow builds the extension, checks out Freelens at
each release tag of its matrix (`v2.0.0`), starts `pnpm dev` there in the
background under `xvfb-run`, with its output in a file and a fresh profile in
`FREELENS_INTEGRATION_TESTING_DIR`, waits until the CDP endpoint answers, and
runs `pnpm test:integration` here. A profile of Freelens dev syncs no
kubeconfig by default, so the workflow seeds the fresh one with a single sync
entry, a file with the kind cluster alone, and the catalog lists that cluster
and nothing else. Every test file is a session of its own on the one app, and
fails on any error logged by either process:

- `extensions.tests.ts` uninstalls whatever installation of the extension the
  app has, installs this checkout in place from the Extensions page and opens
  its preferences page, without changing a preference: the extension's tab in
  the "Extensions" tab group shows the title "Freelens AI Settings" and the
  "API key" label. It needs no cluster.
- `chat.tests.ts` opens the kind cluster with the test objects of
  `integration/fixtures/`: the namespace `integration-tests` and a Warning
  event in it about its `default` ServiceAccount, so no image is pulled. The
  chat page, opened by its route, renders its composer, and "Show Tools" lists
  the agent's tools, which come from main over the bridge and need no model.
  With the API key cleared in the preferences, the composer shows "Configure
  agent", which opens the extension's preferences in the root frame from the
  cluster frame. The row of the event on the Events page lists "Explain" in
  its menu.
- With a model endpoint, the same session sets its base URL, key and model in
  the preferences, selects the model in the composer, clears the chat, and
  sends a prompt that needs the `getNamespaces` tool: the answer has to name
  `integration-tests`. "Explain" of the event then sends the event's message,
  and the run has to end with an answer and no error. Each clears the chat
  first, which also clears the conversation of the agents in main.

The endpoint is `LLM_API_URL`, `LLM_API_KEY` and `LLM_API_MODEL`, an
OpenAI-compatible API such as a LiteLLM proxy. `vitest.integration.config.ts`
reads them with `loadEnv` of Vite, from the environment or from a local
`.env`, which is git-ignored; without any of them both prompts are skipped and
the API key stays cleared. The workflow sets none, so CI runs everything but
the prompts. The session sets only these three preferences and leaves the
others as they are, so a model that needs another one, such as "Disable
thinking mode" for DeepSeek through LiteLLM, needs it set in the profile once.
The key is typed into its input and never logged.

The tests are deterministic, so nothing retries them: the config sets no
`retry`, and the workflow runs the step once, under `timeout 600`. A retry
repeats the same failure, and every view of a session waits its full timeout
before it fails.

The sessions reach the app through its renderer only; the main process, and
with it the application menu, is out of reach of CDP. They navigate the root
frame, and the cluster frame to a page of the host or to the chat, with
`Renderer.Navigation.navigate` of the extension API: the sidebar groups of the
host's kinds are collapsed. They find the kind cluster with
`Renderer.Catalog.catalogEntities` by its name, `kind-<name>`, connect it by
navigating to `/cluster/<id>` and disconnect it with the entity's
`disconnect()`. The preferences render in the root frame over the cluster
frame, which stays loaded behind them, so a test that opens them navigates to
`/cluster/<id>` again in a `finally`; otherwise the preferences would take the
clicks of every later test. `browser.close()` of a browser connected over CDP
closes only the connection, so a session ends with it and the app keeps
running. The renderer's console carries the errors of the root frame and of
every cluster frame; the main log is read from the file that
`FREELENS_MAIN_LOG` names, from its size when the session started, and every
line that starts with `error:` counts, also after a task prefix that turbo may
add, such as `freelens:dev:`, and so does `Error sending from webContents:` or
`webFrameMain:`, which Electron writes to stderr, outside the logger, for a
message that IPC cannot send; `lens.log` does not have those, only the output
of `pnpm dev`. The exception is `proxy_server.go:… Error while proxying
request: context canceled`, which the Kubernetes proxy of Freelens logs for a
request that the renderer aborts: Freelens dev renders in `React.StrictMode`,
which mounts every view twice and aborts the requests of the first mount.
Without the variable only the renderer is checked. A renderer error carries
its location and the worker that logged it; one whose text is empty or only a
class name, such as `ErrorEvent`, is described from its arguments, read from
the page. The one renderer error left out is a "Failed to load resource" with
a 404 or a 503 for `/api-kube/apis/metrics.k8s.io/`: a cluster frame opens on
the host's Cluster Overview, which asks for the metrics of the nodes, and kind
serves no `metrics.k8s.io`. The workflow sets `TURBO_LOG_ORDER=stream` for
`pnpm dev`: in GitHub Actions turbo otherwise groups the output of a task
until it ends, and the persistent `dev` task never ends, so the log would stay
empty.

Vitest runs the files one at a time (`fileParallelism: false`), in no set
order, and none depends on another having run. The cluster session
disconnects the kind cluster, so that its frame, and the chat page in it, load
anew, removes the leftovers of an earlier run (the namespace
`integration-tests`), applies `integration/fixtures/`, and only then connects
the cluster. The frame opens on the host's Cluster Overview, and the chat is
the first view the session opens, so that it loads its transcript, its pricing
and its tools itself, under `React.StrictMode`, as a user's first visit does.
The Events page comes later and selects `integration-tests` in the namespace
filter, unless the filter already shows it; the page does not show an event's
name, so the row is found by the event's message. A session's teardown stops
collecting the errors first, then disconnects the cluster, so that no view
watches the test objects while they are deleted, then deletes them with
`--wait`, also when a test failed, and then checks the errors. The app
refreshes the cluster's permissions while it disconnects it, and when the
refresh loses the race, its requests fail on its own proxy; those errors come
and go with the timing of a run and say nothing about the extension, and the
session no longer collects them.

The code the sessions share is in `integration/__tests__/extension-helpers.ts`:
connecting to the app with the error collector, installing the extension,
connecting and disconnecting the kind cluster, kubectl, the preferences, the
chat, and the selectors. Its name does not match `*.tests.ts`, so Vitest does
not collect it. Its common part, up to the row menus, is the example
extension's, and is kept in step with it. An installation is kept when the
Extensions page lists it as loaded from this checkout: Freelens v2 shows an
extension installed in place as "development", with `Loaded from <directory>`
in its title. The chat's elements are found by the class names that CSS
modules give them in the bundle: kebab case for the chat
(`_messages-container_`, `_message-bubble_`, `_error-message_`,
`_chat-loading-spinner_`), camel case for the preferences (`_modelRow_`) and
the error page (`_errorPage_`), as their stylesheets name them. An answer of
the agent is a `div` without a class in the transcript, and an error message
fails the prompt with its text. The "Show Tools" button holds an emoji, which
is its accessible name, so it is found by its title. `integration/tsconfig.json`
compiles the directory with Node and the DOM, because the callbacks of
`page.evaluate` run in the page, and with the types of
`@freelensapp/extensions`, which declare `globalThis.FreelensExtensionApi` for
them.

Six variables configure the sessions. `FREELENS_CDP_URL` is the CDP endpoint
(`http://127.0.0.1:9223` by default), `FREELENS_MAIN_LOG` the main log,
`TEST_KIND_CLUSTER_NAME` names the kind cluster (`kind` by default, `freelens`
in the workflow), and `LLM_API_URL`, `LLM_API_KEY` and `LLM_API_MODEL` the
model endpoint. Every kubectl call names its context, `kind-<name>`, so a run
never acts on the current context. The checkout to install, and the fixtures,
are found from the location of the helpers. Outside CI a session skips with a
warning when Freelens dev does not answer or the cluster is not reachable; in
CI (`CI` set) the run fails instead, so that a mistake in the workflow does not
turn into a silent skip.

Run locally, the tests act on the profile of Freelens dev, `FreelensDev`,
which is apart from that of an installed Freelens: they navigate its window,
leave this checkout installed in place, uninstalling another installation of
the extension, clear the chat of the kind cluster, change the API key, the
base URL and the list of models in the extension's preferences, and leave the
kind cluster disconnected, with the namespace filter set to
`integration-tests`. Without a model endpoint they leave the API key empty.
They touch no other cluster of the catalog. The profile lists the kind cluster
only once its kubeconfig is in "Kubeconfig Syncs" (see "Checking the
Extension in Freelens Dev"); without it the cluster session fails on the
timeout of finding the cluster. A run deletes the namespace
`integration-tests`: run it only against a kind cluster with nothing worth
keeping there.

## AI Model & Provider System

The list of chat models is user-editable and persisted in the preferences
store; there is no hardcoded model enum. What `PreferencesStore` needs lives in
`src/common/provider/`, since main loads the store too:

- `ai-models.ts` — `AIProviders` enum (only `OPEN_AI` active), the
  `CustomModel` type (`{ provider, name }`), the seed list `DEFAULT_MODELS`
  (`gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`), and `DEFAULT_OPENAI_BASE_URL`.
- `model-list.ts` — pure helpers for the editable list (trim, dedupe, remove,
  `resolveSelectedModel` selection fallback). No host/MobX deps so they are
  unit-tested directly.
- `chat-readiness.ts` — whether a model and a key are configured, asked by the
  chat input and by Explain in main. The renderer has no environment of its
  own: main sets `openAIKeyFromEnvironment` in the store when `OPENAI_API_KEY`
  is set, and never sends the key.
- `model-pricing.ts`, `token-estimate.ts` — the pure cost and token math, used
  by both processes.

The chat models run in main, with the agents (see "Agents and the Bridge"), so
the API key never leaves main and the renderer never talks to the model
endpoint. The rest is in `src/main/provider/`:

- `model-capabilities.ts` — name heuristics (regex) deciding model behavior.
  Add new model families here rather than hardcoding ids. Reasoning models
  (`o<n>`, `gpt-5.x`) take a reasoning effort and reject `temperature`.
- `openai-fields.ts` — pure `buildOpenAIChatFields` builder (endpoint, fetch,
  reasoning-effort/temperature heuristic), unit-tested in isolation.
- `model-provider.ts` — `getModel()` resolves the selected model's provider and
  builds the LangChain client for the base URL of the preferences; throws when
  no model or no key is configured. `resolveOpenAIKey()` takes
  `OPENAI_API_KEY` of main's environment first, then the key of the
  preferences, read per model, so a changed key applies to the next request.
- `offline-token-chat-model.ts`, `dsml-aware-chat-model.ts` — the `ChatOpenAI`
  subclasses: local token counting instead of the tiktoken download, and the
  recovery of DeepSeek's tool calls leaked into the text.
- `model-pricing-provider.ts` — fetches `/model/info` of the endpoint, with the
  key, and the public LiteLLM price list, without it; served to the renderer
  by the `/model/pricing` route of the bridge.
- `agent-rules*.ts`, `prompt-template-provider.ts` — the system prompts and the
  custom agent rules of the preferences.

### HTTP from main

Every HTTP request main makes, to the model endpoint and for the pricing, goes
through `Main.Util.fetch`, never the global `fetch` or a bundled client's
default one, so the user's HTTPS proxy, CA certificates and "allow untrusted
CAs" preferences apply. `Main.Util.fetch` is typed as the standard `fetch`
(C12), so it is the `fetch` option of the OpenAI client as it is, and
`model-pricing-provider.ts` takes it too. `model-provider.ts` reads it when a
request is sent, since the namespace exists only once the extension is loaded.
The host translates a `Request` input and encodes a `FormData` body for its
client, and drops a `dispatcher` of the init, so that its own always applies.

When changing the heuristics or list logic, prefer extending the pure helpers
and add/adjust the matching `*.test.ts` (run with `pnpm test:unit`). The tests
of the provider replace `Main.Util.fetch` with the stub's `vi.fn()` and assert
on the request the client sends.

## Agents and the Bridge

The LangGraph agents run in main (`src/main/agents/`), not in the renderer.
LangGraph's `interrupt()`, the approval gate of every mutating tool, takes its
run config only from LangChain's `AsyncLocalStorage`. Main bundles LangGraph's
Node entry, which installs one; a browser page has none, and there
`interrupt()` throws "Called interrupt() outside the context of a graph.",
which `ToolNode` hands to the model as the tool's result, so a write is never
applied and no approval is asked. Keep LangChain out of the renderer: the
renderer bundle carries no `@langchain/*`, `openai` or `zod`, and a view needs
none of their types, since every message of the bridge is plain JSON.

The renderer keeps the views and talks to the agents over a local HTTP bridge
in main, not over `Main.Ipc` / `Renderer.Ipc`: the stream of a run is the
response to the request of the frame that started it, so nothing is broadcast
to every frame and filtered by cluster, and closing the request cancels the
run.

- `src/common/bridge/protocol.ts` — the routes, the request and response
  bodies and the events of a run; `sse.ts` encodes and reads the event stream.
- `src/main/bridge/server.ts` — the `node:http` server on `127.0.0.1` and an
  ephemeral port. `routes.ts` parses the bodies and maps the routes to the
  `AgentRuntime`; a body it cannot parse is refused before anything runs.
- `src/main/agents/agent-runtime.ts` — the agents of every cluster, keyed by
  the cluster id each request carries, so two cluster frames never share a run
  or a memory. `agent-service.ts` runs a graph and turns its stream into the
  events below.
- `src/renderer/business/bridge/bridge-client.ts` — requests with
  the global `fetch`, Chromium's, which the host uses in the renderer too;
  its `body` is a `ReadableStream` that `readSseEvents`
  reads as it arrives. The port and the token are read from `PreferencesStore`
  for every request.

### Protocol

Every request goes to `http://127.0.0.1:<aiProxyPort>` with the per-launch
token of `aiProxyToken` in the `x-freelens-ai-token` header; without it, or with
a wrong one, the answer is `401`, so another local process that learns the port
cannot drive the agents with the user's key. A CORS preflight needs no token.
The caller's `Origin` is reflected, not `*`: the frames are served from
`https://renderer.freelens.app:<port>` and
`https://<clusterId>.renderer.freelens.app:<port>`. An unknown route is `404`,
a wrong method `405`, and a failure before a stream starts `500` with
`{ "error": message }`.

| Route                 | Request                                | Answer                                       |
| --------------------- | -------------------------------------- | -------------------------------------------- |
| `POST /agent/run`     | `{ clusterId, conversationId, input }` | SSE of run events                            |
| `POST /agent/explain` | `{ clusterId, text }`                  | SSE of `text` events                         |
| `POST /agent/compact` | `{ clusterId, conversationId }`        | `{ summary, contextTokens }`                 |
| `POST /agent/clear`   | `{ clusterId, conversationId }`        | `{}`                                         |
| `GET /agent/tools`    | `?clusterId=`                          | `{ tools: [{ name, description }] }`         |
| `GET /model/pricing`  |                                        | the pricing of the models of the preferences |

The `input` of a run is `{ kind: "message", text, summary? }`, a prompt, where
`summary` seeds a just compacted session, or `{ kind: "resume", answer }`, the
answer to a pending approval. A stream is `text/event-stream`, one
`data: <json>` line per event:

- `text` and `reasoning` — the answer and the model's reasoning, as generated;
- `usage` — a token usage delta for the session counter, negative when a retry
  rolls back a failed attempt;
- `context` — the size of the persisted conversation the next prompt re-sends,
  and the largest single call of the run;
- `interrupt` — a pending approval (`ApprovalRequest`); the run ends after it,
  and the renderer answers with a `resume` run of the same conversation;
- last, `done`, or `error` with `{ message }`.

A new route or event goes into `protocol.ts` first, with the parser in
`routes.ts` and a test over HTTP in `routes.test.ts`.

### Runs and their cluster

The cluster id of a request travels in the run config as
`configurable.clusterId`, next to `thread_id`, the conversation. LangChain
hands the run config to a tool function as its second argument, and the
Kubernetes tools (`src/main/agents/tools/`) read the cluster there:
`cluster-api.ts` checks it with `Main.Catalog.getClusterById` and returns the
host's `Main.K8sApi.KubeJsonApi.forCluster` client; without a cluster, or with
one Freelens does not know, a tool answers the model with a message and sends
nothing. Never read the cluster from a module-level variable: two cluster
frames run at once.

Every request of a tool goes by path. A kind and an apiVersion resolve to their
plural and scope from the API server's discovery document of the group version
(`resource-paths.ts`), so built-in kinds, custom resources, subresources and
`/version` are reached the same way, and the write operations send what the
host's `KubeApi` sends: the kind, apiVersion, name and namespace set on a
created or updated manifest, merge patches, a strategic merge patch for a
subresource or a restart, delete options with background propagation, the
eviction subresource. A write tool loads the current object as a backup, then
calls `requestApproval()`, whose `interrupt()` must run inside the tool, that
is inside the graph run.

The checkpointer of each agent is a `PersistentMemorySaver`, which mirrors the
LangGraph state into `AgentStateStore` under a namespace of the cluster id and
the agent (`checkpointNamespace`), so the memory of every cluster survives a
restart on its own. Only main loads `AgentStateStore`. `clear` wipes the
conversation of the cluster's agents and only that cluster's checkpoints.

### Lifecycle

Main starts the bridge in `onActivate`, with a new token, and writes the port
and the token into `PreferencesStore`. `onDeactivate` sets the port to `null`
and closes the bridge, which aborts every open request and so every run: the
abort reaches LangGraph as the run's `signal`, and a retry backoff resolves at
once (`wait.ts`). A reload therefore leaves exactly one bridge bound, and the
chat reaches the new one without reopening the page. Do not keep a server, a
timer or a run in module state that `onDeactivate` cannot reach.

### MCP servers

With MCP enabled in the preferences, the MCP agent (`mcp-agent.ts`) takes the
place of the supervisor, with the tools of the user's MCP servers. The servers
run in main (`src/main/mcp/`), never in the renderer, which cannot spawn a
process; an MCP tool call never leaves main, and the renderer sees only the
agent's stream and its approvals, through the bridge.

- **One client per cluster.** `McpClients` keeps one `MultiServerMCPClient` of
  `@langchain/mcp-adapters` per cluster id, built from the `mcpServers` of the
  `mcpConfiguration` preference (`mcp-configuration.ts`). The servers start on
  the first request for a cluster, a run or the tool list, and keep running
  for the next ones. A failed start leaves nothing running, and the next
  request tries again; an empty or invalid configuration has no servers, and
  the client refuses it with "No MCP servers provided", which the chat shows.
- **The environment.** A stdio server is a child process of main, started with
  `Main.Shell.getEnvironment(clusterId)` under the server's own `env`, where a
  variable the user set wins. That environment has the `KUBECONFIG` and
  `KUBECACHEDIR` that reach the chat's cluster through Freelens, and its
  `PATH` resolves `npx` and other commands named without a path, so the
  default `npx mcp-server-kubernetes` acts on the cluster the chat is open for,
  not on the kubeconfig's current context. The environment is asked for only
  when a stdio server is configured: it rejects for a cluster that is not
  connected. HTTP and SSE servers are reached from main as they are configured.
- **Lifecycle.** The servers of a cluster stop when the configuration they
  were started with changes; every server stops when MCP is turned off or its
  configuration changes (a `reaction` in `AgentRuntime`) and in
  `onDeactivate`, through `AgentRuntime#dispose()`, so a reload or disabling
  the extension leaves no server process behind. A cluster's servers stop when
  it is no longer connected, since a disconnect removes the files of its
  environment: a `reaction` on the statuses of `Main.Catalog.getAllClusters()`,
  which the host computes with its mobx. They start again, with a fresh
  environment, on the next request. `MultiServerMCPClient#close()` ends the
  process of every stdio server.
- **The agent.** The MCP agent of a cluster is built from the tools of its
  client and rebuilt when the servers were started again, since its tools call
  the servers that were running when it was built; the checkpointer hydrates
  from `AgentStateStore`, so the conversation continues. Its approval gate is
  `interrupt()` in the synchronous `shouldContinue` node, before any tool runs.

## Checking the Extension in Freelens Dev

The functional checks of a change run against Freelens started with
`pnpm dev` from a freelensapp/freelens checkout. That script starts Electron
with `--remoteDebuggingPort 9223`, so an agent can drive the app over the
Chrome DevTools Protocol, with Playwright MCP as Freelens's `DEVELOPMENT.md`
describes ("Inspecting the running dev app from an AI agent"), or with a
`playwright-core` script that calls
`chromium.connectOverCDP("http://127.0.0.1:9223")` and ends by exiting the
process, never by closing the browser, which belongs to Freelens. Playwright
MCP writes its snapshots to `.playwright-mcp/`, which is git-ignored.

- **Installing the checkout.** `pnpm install`, then `pnpm build`, since
  Freelens loads the extension from `dist/`. On the Extensions page, enter the
  checkout's directory, press "Install" and confirm loading it in place; it is
  listed as "in place, unverified". A rebuild, by `pnpm build` or `pnpm dev`,
  reloads it in main, in the root frame and in each cluster frame.
- **What a check needs.** A cluster (the maintainers use `kind-kind` with
  Flux and workloads deployed by it), and a model endpoint with a key, set in
  the preferences; an OpenAI-compatible gateway such as LiteLLM works as the
  base URL. MCP needs `npx` on the login shell's `PATH`.
- **The kubeconfig of a dev profile.** A profile of Freelens dev syncs no
  kubeconfig until one is added in "Kubeconfig Syncs" of the Kubernetes
  preferences, so its catalog lists none of the developer's clusters;
  `KUBECONFIG` does not change that. For the checks, add a kubeconfig with the
  test cluster alone, such as the output of
  `kubectl config view --minify --flatten --context kind-kind`. A fresh
  profile, in a `FREELENS_INTEGRATION_TESTING_DIR` under the system's
  temporary directory, can start with it already in place: seed
  `FreelensDev/lens-user-store.json` there with
  `preferences.syncKubeconfigEntries`, whose `filePath` is absolute
  ("Kubeconfig syncs of the dev profile" in Freelens's `DEVELOPMENT.md`).
- **Frames.** Every cluster renders in a cross-origin
  `<clusterId>.renderer.freelens.app` iframe; the chat page, the sidebar entry
  and the "Explain" item live in that frame, the preferences in the root frame.
  The chat page is `/extension/freelensapp--ai-extension/ai-extension-main-page`.
  A DOM `click()` on the sidebar entry's
  `[data-testid="link-for-sidebar-item-…"]` element navigates; a click on its
  `[data-testid="sidebar-item-…"]` element does not.
- **The console.** The renderer console also carries the output of Freelens's
  terminal dock, which can include the user's shell prompt, account names and
  paths. Keep only warnings, errors, page errors and the extension's own lines,
  and never paste the full console into a PR, an issue or a report. React
  reports a missing `key` and a prop the DOM does not take as console errors;
  they count as failures of the "no error in DevTools" check.
- **Failed loads.** The renderer's requests, to Kubernetes and to the bridge,
  go through Chromium, which logs every response that is not a success as a
  console error, `Failed to load resource: the server responded with a status
  of N`, also one that the code that sent it handles. The text names no URL;
  the location of the message does. Leave out such an error by its status and
  URL only where the response is expected, not every "Failed to load
  resource".
- **Main.** The agents, the bridge and the MCP servers log in main: in the
  terminal running Freelens, and in its log file (on macOS
  `~/Library/Logs/Freelens/lens.log`, with the renderer's `lens-renderer-*.log`
  next to it); when the terminal is not at hand, the file shows the
  extension's activation, its reloads and its own lines. Filter it as the
  console. The process list shows whether an MCP server is still running, and
  its environment which cluster it reaches.
- **Disabling and enabling.** Without a restart of Freelens, disabling and
  enabling the extension leaves two instances of its store in main, which
  overwrite the bridge token in an endless save loop (freelensapp/freelens#2721).
  Restart Freelens after enabling it again; rebuilds are not affected.

## Code Style

- **Biome** formats **TypeScript/TSX, JavaScript, JSON, CSS, SCSS, HTML, YAML and Markdown**: double quotes, semicolons, trailing commas, 2-space indent, 120 char line width — use `pnpm biome:fix`
- **Trunk** formats **TOML and shell scripts**, and runs the linters for formats not covered by Biome (yamllint, actionlint, shellcheck) — use `pnpm trunk:fix`
- Import order (enforced by biome organizeImports): built-in modules → `@freelensapp/**` → packages → relative paths
- React 19, provided by the Freelens host
- **No emoji** in Markdown files (`.md`), comments, or any source code

## Security

Never read, display, reference, or include the contents of the following files in any response or context, even if they are open in the editor:

- `.env`
- `.env.*`
- `.envrc`
- `.npmrc`
- `*.jks`
- `*.keystore`
- `*.p12`
- `*.pfx`
- `*.pem`
- `*.key`

The same list is git-ignored in `.gitignore` and enforced for Claude Code by
the `permissions.deny` rules in `.claude/settings.json`, which block reading
and editing these files. Change all three together. The rules are native
permissions rather than a hook on purpose: a hook runs a process in the
working tree, which may be an untrusted pull request, and an interpreter such
as `python3 -c` imports modules from that tree before the hook's own code.

## Electron Multi-Process

Extensions run in the same multi-process model as the Freelens host:

- **Main process** (`src/main/`) — Node.js environment, extension lifecycle, cluster connectivity
- **Renderer process** (`src/renderer/`) — Chromium browser, UI components

Code in `src/common/` is shared between both processes.

## Troubleshooting

### Changes Not Appearing

1. Check that files are not in ignored output directories (`dist/`, `node_modules/`)
2. Full clean and rebuild: `pnpm clean:all && pnpm install && pnpm build`
3. For a directory install, check that `pnpm dev` is running, or rebuild with `pnpm build`; after a change to `main` or `renderer` in `package.json`, restart Freelens
4. For a tarball, reinstall the extension in Freelens

### Build Failures

1. Check for TypeScript errors: `pnpm type:check`
2. Check for linting errors: `pnpm lint:check`
3. Verify dependencies: `pnpm install`
4. Check Node.js version matches the `engines` field in `package.json`

### Runtime Errors

1. Open Freelens DevTools and check the Console tab for renderer errors; the chat runs in the cluster frame, the preferences in the root frame
2. Check the terminal where Freelens was launched for main process errors: the agents, the bridge, the model requests and the MCP servers run there
3. Look for stack traces with file:line numbers
4. Check the change against "Rules That Fail Silently"
5. Validate both with `pnpm type:check` **and** `pnpm build` — runtime failures can appear only in bundled `dist/` code

## Best Practices

1. **Use semantic search** to find examples and patterns in the codebase
2. **Follow existing patterns** — grep for similar implementations before creating new ones
3. **Test changes** before committing
4. **Run validation before committing:** `pnpm lint:fix && pnpm type:check && pnpm test:unit`
5. **For TypeScript/TSX, JavaScript, JSON, CSS, SCSS, HTML, YAML and Markdown files:** run `pnpm biome:fix` (or `biome check` directly if `biome` is installed locally)
6. **For other formats:** run `pnpm trunk:fix` (or `trunk check` directly if `trunk` is installed locally), and `pnpm trunk:check:all` before pushing
7. **Full build** when in doubt about cached state: `pnpm clean:all && pnpm install && pnpm build`
8. **Do not use Anthropic Fable for coding tasks** — Fable may be used only for planning,
   analysis, and thinking through problems. When writing or editing code,
   use standard editing tools instead.

## GitHub Actions (Claude Code Action) Rules

This project has a Claude Code workflow (`.github/workflows/claude.yaml`) triggered
via `@claude` comments on issues, PR comments, and reviews. When operating via that
workflow, follow these rules:

### Code Review

When reviewing code and proposing fixes:

1. **Show the diff first** — present every proposed change as a unified diff
   block using the `diff` language tag:

   ```diff
   --- a/path/to/file.ts
   +++ b/path/to/file.ts
   @@ -10,7 +10,7 @@
    const oldLine = "before";
   -const changedLine = "after";
   +const changedLine = "the fix";
    const unchangedLine = "same";
   ```

   You can generate this from the terminal with:

   ```bash
   git diff -u -- path/to/file
   ```

   If the change spans multiple files, group them under a single commit
   subject and show each file's diff sequentially.

2. **Propose a commit subject first** — before any code change, output a
   single line with the proposed commit subject:

   ```text
   **Proposed commit:** <short description>
   ```

   Do **not** use Conventional Commits prefixes (e.g. `fix:`, `feat:`,
   `chore:`, `refactor:`, `docs:`, `test:`, `ci:`). This project prefers
   plain, descriptive commit messages and PR titles without any prefix.

   Wait for the user to confirm (or adjust) the subject before applying the
   change.

3. **Comment style:**
   - Keep review comments concise and actionable
   - Reference specific lines (file + line number) when pointing out issues
   - Offer a concrete fix suggestion rather than just flagging a problem
   - Do **not** use emoji in any Markdown, comments, commit messages, or
     PR descriptions. The only exception is emoji that already appears
     inside code strings (e.g. application logs, user-facing messages).
   - Use GitHub's `suggestion` block for small targeted fixes so the PR
     author can accept the change with a single click:

     ```suggestion
     <same unified-diff format as shown above>
     ```

   - For larger multi-file changes, use `diff -u` blocks in a regular
     comment instead, with the proposed commit subject shown first

### Making Changes to a PR

When asked to implement a change on a PR:

1. Propose the commit subject (as above)
2. Describe what will change and why
3. After confirmation, apply the changes with commits on the PR branch
4. **One commit per fix** — when a review surfaces more than one issue or
   the plan includes more than one fix, apply and commit each fix
   separately. Do not batch multiple independent fixes into a single
   commit. This keeps the history bisectable and makes each change easy
   to revert individually.

### Force-Pushing a Rewritten Branch

When you are asked to rebase a pull request branch, or to rewrite its
history in another way (amend, squash, drop a commit), push the result with:

```bash
git push --force-with-lease origin HEAD
```

The push wrapper the action names in its instructions, `git-push.sh`, accepts
no flags, so it cannot do this; `git` itself is allowed in this workflow.
Do not fall back to merging `main` into the branch instead: a merge commit is
not what was asked for.

Force-push only the pull request branch the run was invoked on, and only when
the request calls for a rewrite. Never force-push `main` or any other branch,
and never rewrite a history you were not asked to.

### Modifying GitHub Actions Workflows

Claude cannot push changes to files under `.github/workflows/` directly,
because the GitHub token used by the action lacks the `workflows` permission.
Any patch to a workflow file MUST therefore be delivered as a new, complete
file under the `github-workflow-fix/` directory in the repository root instead
of editing the file in place:

1. Write the full, final contents of the workflow to
   `github-workflow-fix/<workflow-file-name>`, with the same file name as in
   `.github/workflows/` (e.g. `github-workflow-fix/check.yaml`). Do **not**
   edit the original file under `.github/workflows/`.
2. Make it a **complete** file — the entire workflow as it should look after
   the change, not just a diff or fragment — so it can be copied verbatim.
3. Commit it with the change that needs it, and list it in the report. In the
   PR description, note it as a proposed workflow change that a maintainer
   must move from `github-workflow-fix/` to `.github/workflows/`.

A maintainer moves the file into `.github/workflows/` in a separate commit and
removes `github-workflow-fix/`. Pull before continuing on the branch, as it may
have gained such a commit. A change that depends on the moved workflow (a
script it calls, a path in `knip.jsonc`) waits for that commit, or keeps the
old one working until then.

### Branch Naming Conventions

When creating a branch from an issue, use a human-readable name that includes
the issue number and a short slug derived from the issue title:

```text
claude/issue-<number>-<short-slug>
```

- `<number>` is the GitHub issue number
- `<short-slug>` is a kebab-case summary of the issue title, kept short
  (3–6 words maximum, omit articles and filler words)

Do **not** use auto-generated timestamp suffixes (e.g.
`claude/issue-1957-20260612-2108`) — these are not human-readable and make
branch lists hard to scan.

### Fork PRs: Review Only

A PR from a fork (different owner than `freelensapp`) gets a review and
nothing else: no commits, no pushes, no branches. Its code is untrusted, and
the head of a fork PR can change between the moment a maintainer looks at it
and the moment the workflow checks it out, so nothing taken from the checkout
may reach `freelensapp/freelens-ai-extension`.

When a fork PR needs changes, a maintainer first copies the exact commit they
reviewed to a branch in this repository. From then on it is a
same-repository PR, which gets the full setup and the normal workflow. The
copy is made either locally (`gh pr checkout <N>`, then push the branch) or
by the Claude Task workflow, following "Copying a Fork PR" below.

### Copying a Fork PR

This applies to a Claude Task run whose prompt asks to copy a fork PR and
names the PR number and the full commit SHA to copy. It is a git-only task:
do not check out, read, build or run any of the PR's files, and do not
describe its changes, because they are untrusted input.

1. `git fetch origin refs/pull/<N>/head`.
2. Verify that `FETCH_HEAD` equals the given SHA. If it does not, or no full
   SHA was given, stop and report the actual head without pushing anything.
3. `git push origin <sha>:refs/heads/claude/pr-<N>`.
4. Open a PR from `claude/pr-<N>` to `main`. It MUST use the **exact same
   title** as the original PR, copied verbatim with no prefix, and its body
   is `Copy of #<N> at <sha>.` followed by the usual footer.
5. Comment on the original PR with a link to the new one.
