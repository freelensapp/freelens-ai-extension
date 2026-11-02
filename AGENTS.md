# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

> **Tip**: If you find yourself correcting the agent during interactive work, suggest adding a new rule to this file so the lesson is captured for future sessions.

## Project Overview

Freelens AI (`@freelensapp/ai-extension`) is an extension of the Freelens v2
extension API that adds an AI chat to every cluster: a pi agent in the main
process that reads and, with the user's approval, changes Kubernetes
resources, an "Explain" item on warning Events, and a preferences page for
the providers, the thinking level, the tool approvals and the agent rules. It
is built on the patterns of freelensapp/freelens-example-extension, the
template of the Freelens extension docs.

- **Language**: TypeScript 7.0.2
- **Runtime**: Freelens >= 2.0.0 (extension API v2)
- **Agent**: pi 1.4.0 (`@earendil-works/pi-coding-agent` and
  `@earendil-works/pi-ai`), bundled into the main entry
- **Toolchain**: Node.js 24.x, yq 4.x and cosign 3.x (`mise.toml` with
  `mise.lock`; Node also in `.nvmrc`)
- **Package manager**: pnpm 12.x (`packageManager`, run through corepack)
- **License**: MIT

Library and tool versions follow the Freelens stack: the libraries the
extension shares with Freelens (`react`, `mobx`, `mobx-react`,
`monaco-editor`, `typescript`, `vite`, `vitest`, `electron`, ...) are pinned to
the versions of the Freelens `pnpm-workspace.yaml` catalog at the commit the
pinned `@freelensapp/extensions` nightly was built from; the tools run with
`pnpm dlx` (Biome, knip, the Trunk launcher) to the root `package.json`
scripts of Freelens; Node and the other mise tools to Freelens's `mise.toml`
and `.nvmrc`. Renovate keeps them there: custom datasources in
`.renovaterc.json` read the versions from the same Freelens files on `main`,
so an update arrives only once Freelens has adopted it, at that version, in
one "Freelens dependencies" group together with the nightly. A bundled library
that Freelens does not have, pi and `typebox` among them, is excluded from the
catalog rule and updated as usual (see "Modules provided by the host"). After
changing `mise.toml`, run `mise lock`, which re-locks every platform, not only
`mise install`.

pnpm settings live in `pnpm-workspace.yaml`. A dependency runs its install
scripts only when `allowBuilds` sets it to `true`, and a new dependency with
install scripts that is not listed there fails `pnpm install`, so add it with
`true` or `false` deliberately; pi's dependencies `@google/genai` and
`protobufjs` are listed with `false`, since the bundle needs neither script.
`@freelensapp/extensions` is excluded from `minimumReleaseAge`, because its
pinned nightly is often adopted on the day it is published.
`strictPeerDependencies: true` makes `pnpm install` fail when the extension's
own copy of a library it shares with the host (`react`, `react-dom`, their
types, `mobx`, `mobx-react`, `monaco-editor`, `electron`) is
outside the peer range `@freelensapp/extensions` declares for it; without it
pnpm prints one warning line and installs anyway, and these peers are the only
place where the extension's copies are compared with the versions the host
runs. `monaco-editor` is declared, without being imported, because the
`options` of `Renderer.Component.MonacoEditor` take their types from it;
without it they are `any`, and `skipLibCheck` hides the unresolved import.
`react-select` is declared for the `SingleValue` type of the preferences
page only, at the version `@freelensapp/extensions` depends on.

## Common Commands

```bash
# Type checking
pnpm type:check                # All of the programs below, in this order
pnpm type:check:sources        # main and renderer, each with src/common/
pnpm type:check:tests          # Tests and test support
pnpm type:check:tooling        # Vite and Vitest configs, build scripts and plugins
pnpm type:check:environments   # Environment tests

# Linting & formatting
pnpm biome:check          # TypeScript/TSX, JavaScript and JSON (biome)
pnpm biome:fix            # Auto-fix TypeScript/TSX, JavaScript and JSON
pnpm trunk:check          # Markdown, YAML, SCSS and other formats not covered by biome (modified files)
pnpm trunk:check:all      # The same over every file, as trunk-check.yaml runs it
pnpm trunk:fix            # Auto-fix Markdown, YAML, SCSS, etc.
pnpm lint:check           # biome check (all biome formats)
pnpm lint:fix             # biome fix (all biome formats)
pnpm knip:check           # Unused files and dependencies; run after `pnpm build`

# Tests
pnpm test:unit            # vitest

# Build
pnpm build                # Renderer and main bundles in dist/ (no type check), then `pnpm check:dist`
pnpm check:dist           # Checks of the built output (see "Checks of the built output")
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
  main/index.ts                      # Extension entry point (main process, ESM): store, pi's ModelRuntime, agent host, provider service, IPC handlers
  main/agent/                        # Agent host, approval gate, CLI runner, system prompts, provider service, custom endpoints, old-settings import
  main/agent/tools/                  # The kubectl and helm tools: the gate's reads of the cluster, dry-run previews, Secret redaction, block reasons
  main/utils/                        # Logger of main
  renderer/index.tsx                 # Extension entry point (renderer process, ESM): pages, menus, preferences
  renderer/business/agent-client/    # Frame side of the agent protocol and the pure chat reducer
  renderer/business/provider-client/ # Frame side of the provider protocol and the chat's model picker
  renderer/business/cluster/         # Cluster id of the frame
  renderer/business/cli/             # Command line of a CLI invocation, as the cards show it
  renderer/business/objects/         # Chat message objects of the views
  renderer/components/, pages/       # Views: chat, messages, approvals, code blocks, preferences, error boundary
  renderer/context/                  # Application context of a cluster frame
  renderer/navigation/               # Id of the chat page
  renderer/icons/, utils/            # The sidebar icon; the useLog hook of the views
  common/agent-protocol.ts           # Agent IPC protocol: commands, envelopes, snapshot, pi's shapes
  common/provider-protocol.ts        # Provider IPC protocol: status, models, logins, custom endpoints
  common/agent-tools/                # Tool definitions, shared with the chat's tool list
  common/invocation-policy/          # The invocation policy: parser, canonical forms, floor, rules, shipped profiles, dry-run verbs
  common/store/                      # PreferencesStore, shared by both processes, and the old-preference fields
  common/objects/                    # Chat message object types
  common/utils/                      # Logger factory, redaction, ids, command-line splitting
test/                                # Test stub of @freelensapp/extensions, the stand-in CLI and the fake kubectl
environment-tests/                   # Probes that prove the per-environment type check (see "TypeScript")
integration/__tests__/               # Integration tests, run inside a Freelens checkout (see "Lint and CI")
build/                               # Vite plugins and the checks of the built output
```

Build output goes to `dist/`: `dist/main.js`, `dist/renderer.js` and
`dist/renderer.css`, the entries `package.json` names.

The extension presents no custom resource and has no `KubeObject` model of its
own: the agent reaches every kind through kubectl, and Helm releases through
helm, from main (see "CLI
invocations in the main process"), and the views use the host's `KubeEvent`
only. So `customResources` of the renderer extension is not set.

## Renderer Components

- **Registrations.** `src/renderer/index.tsx` registers the chat page
  (`clusterPages`), its sidebar entry (`clusterPageMenus`), the "Explain" item
  of the Event menu (`kubeObjectMenuItems`), the preferences
  (`appPreferences`) and the "Freelens AI" tab of a cluster's settings
  (`entitySettings`, for `Common.Catalog.KubernetesCluster`'s `apiVersion` and
  `kind`), whose view receives the cluster's catalog entity, its id the
  cluster id. The "Explain" item is built with
  `Renderer.K8sApi.menuItemFor(Renderer.K8sApi.KubeEvent, { MenuItem })`, and
  its props extend `Common.Types.KubeObjectMenuItemProps<KubeEvent>`. The page
  id is `MAIN_PAGE_ID` of `src/renderer/navigation/pages.ts`, used wherever the
  page is named. `onActivate` starts the agent client and the provider client
  and `onDeactivate` stops them (see "The pi agent" and "Lifecycle").
- **Error boundary.** `clusterPages`, `kubeObjectMenuItems`,
  `appPreferences` and `entitySettings` are mapped through
  `withPageErrorBoundary`, `withMenuItemErrorBoundary`,
  `withPreferenceErrorBoundary` and `withEntitySettingErrorBoundary` of
  `src/renderer/components/error-boundary.tsx`, so that an entry added to them
  is wrapped too. An error a page, a preference `Input` or a settings tab
  throws shows the error page in its place; one a menu item or a preference
  `Hint` throws leaves it out. Either is logged with `Common.logger` and the
  extension's name. The host has no boundary around a menu item, an
  extension's preferences or a settings tab, and its boundary around a frame
  would replace the whole cluster view, preferences page or settings page.
- **Policy profiles.** The cluster's profile is picked by
  `ClusterProfilePicker` of `src/renderer/components/cluster-profile/`, on the
  settings tab and in each row of the preferences' cluster table, which lists
  `Renderer.Catalog.getAllClusters()`; `ClusterProfileBadge` shows it in the
  chat header. They read it with `clusterPolicyProfile` inside an `observer`
  and replace `profileAssignments` as a whole, which makes main check the
  pending approvals again (see "Approvals").
- **Preferences.** `src/renderer/pages/preferences/preferences-page.tsx` is
  the `Input` of the one `appPreferences` entry, an `observer` that writes
  `PreferencesStore` directly; text areas commit on blur. Its providers
  section, `provider-settings.tsx`, talks to the provider service in main (see
  "Providers and models") and opens a login's sign-in page with
  `window.open(url)`, for `http:` and `https:` URLs only; Freelens hands it to
  the system browser. The host's `Switch` renders only its `children` in its
  label and passes every other prop, `className` and `style` included, to the
  checkbox. Its profile editor, `policy-profiles/`, writes the policy
  profile fields (`userProfiles`, `profileAssignments`, `defaultProfileId`)
  through `policy-profile-edits.ts`, each replaced as a whole in a MobX
  action and never changed in place, since replacing one is what makes main
  check the pending approvals again (see "Approvals"). Its test box,
  `profile-test-box.tsx`, splits a typed command line with `splitCommandLine`
  of `src/common/utils/`, without a shell, and evaluates it with
  `evaluateInvocationPolicy`, as the gate does, but with
  `BUILT_IN_RESOURCE_CATALOG` and the namespace `default`; its floor list,
  `floor-list.tsx`, reads `FLOOR_ENTRIES`, so an entry added to the policy
  shows there.
- **Navigation.** A registration hands the extension instance to its view
  (`<MainPage extension={this} />`, `<MenuEntry {...props} extension={this} />`),
  never through module state. A view opens the chat page with
  `extension.navigate(MAIN_PAGE_ID)` and the extension's preferences with
  `extension.navigateToPreferences()`, which the chat's "Connect a provider"
  button reaches through `navigateToPreferences` of the application context.
  The chat runs in the cluster frame and the preferences live in the root
  frame: `navigateToPreferences()` reaches the root frame, which
  `Renderer.Navigation.navigate` does not, and no route is written by hand.
- **Host components** come from `Renderer.Component`, destructured at module
  level (`Button`, `Select`, `MonacoEditor`, `MenuItem`, `Icon`, ...).
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
- A component's stylesheet is a CSS module next to it, `x.module.scss`, imported as `import styles from "./x.module.scss"` and used as `className={styles.someClass}`; there is no `?inline` import and no `<style>` element. The host's own classes and theme markers are matched with `:global(...)`, for example `:global(body.theme-light) .x` and `.x :global(.Select__single-value)`, since every other class name in a module is scoped. Ids are scoped too, so a module never styles by id.
- CSS modules get TypeScript declarations (`*.module.d.scss.ts`) from `build/vite-plugin-css-module-declarations.mjs`, written by the renderer build (see "CSS module declarations" under "Build").

## Rules That Fail Silently

Each of these compiles when it is broken, and breaks the extension at runtime
or not visibly at all. The sections named in parentheses explain the
mechanism; this is the list to check a change against.

- **The host's React and mobx, one copy each.** Import `react`, `react-dom`,
  `mobx` and `mobx-react` by their bare module ids. A second React throws
  `invalid hook call`; a second mobx throws nothing, and the host never reacts
  to its observables. The build fails on the ways a second copy gets in, and
  `pnpm check:dist` on an inlined copy ("Modules provided by the host").
- **The stores keep the annotation map.** An observable field of a store is a
  plain field listed in `makeObservable(this, { field: observable })` after
  `super()`. A decorator on a plain field type-checks and leaves the field
  unobservable in mobx's production build; an `@observable accessor` field
  moves the value behind a getter, which `toJSON()`, `toJS()` and spreading do
  not see ("Decorators and the stores").
- **No Node or Electron in renderer and common code.** They are `undefined` in
  the renderer. The build fails on an import, `pnpm type:check` on a global
  ("Process-specific settings").
- **pi in main only.** Every entry point of pi's packages reaches Node's types
  through the provider SDKs it exports, so no file of `src/common/` or
  `src/renderer/` imports pi, not even a type, nor anything that reaches it.
  The environment tests fail on it as unused `@ts-expect-error` directives in
  `environment-tests/node-apis.ts`; `src/common/agent-protocol.ts` declares
  the pi shapes the frames read instead ("The IPC protocol").
- **Main is built for the `node` platform.** On the `browser` platform a
  bundled CommonJS package's `require()` of a builtin throws only when
  `dist/main.js` is evaluated; the build and the type check pass, and only the
  load in `pnpm check:dist` catches it ("Process-specific settings").
- **The main bundle is one file.** pi loads its providers with dynamic
  `import()`. As chunks, the ones a rebuild leaves unchanged would be taken
  from Node's module cache on a development reload, state included
  ("Build").
- **One CSS asset, `dist/renderer.css`.** Any other name, or a second asset,
  leaves the extension unstyled. `pnpm check:dist` fails on it ("CSS").
- **One tsconfig per environment.** Each program has only its runtime's `lib`
  and `types`, and no declaration may load Node into the renderer or the DOM
  into main; otherwise a wrong API type-checks and is `undefined` at runtime.
  The environment tests fail on a leak ("TypeScript").
- **The cluster from the command.** The agent host takes the cluster id with
  every command (`handleCommand(clusterId, command)`) and runs a CLI invocation
  with the kubectl or helm and the environment of that cluster, never of one kept in
  module state: two cluster frames run at once, and a module-level cluster
  sends one chat's invocation to the other's cluster ("CLI invocations in the
  main process").
- **Every CLI invocation goes through the invocation policy.** The tool runs
  only a call that the gate let through (`passedCliCalls`), with what the
  policy decided about it, the Secret redaction included. A new tool, or a new
  path to the runner, that skips the gate runs the agent's arguments past the
  floor and the profile, and prints Secret values. Only the gate's own reads
  and dry runs skip it ("Approvals").
- **`execFile`, never a shell.** The runner passes the argument array to
  `execFile`, without `shell`. Through a shell (`exec`, or `shell: true`), an
  argument such as `$(...)` or `; rm -rf ~` runs on the user's machine, and
  the shell reads the arguments differently from the parser that checked them.
  Only the manifest goes on standard input ("CLI invocations in the main
  process").
- **Every new pi session gets the injected fetch.** A session created without
  `useInjectedFetch(session)` sends its model requests with Node's global
  `fetch`, which works, but ignores the user's proxy and certificate
  preferences ("HTTP from main").
- **Nothing in module state that `onDeactivate` cannot reach.** A session, a
  timer, a run or a login kept there survives a reload, and the next
  `onActivate` starts a second one ("Lifecycle").
- **Every page, menu item, preference and settings tab inside an error
  boundary.** The host has none around a menu item, an extension's
  preferences or a settings tab, and its boundary around a frame replaces the
  whole cluster view, preferences page or settings page. Map the
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

Neither `pnpm build` nor `pnpm dev` runs the type check, so a Node global in
renderer code passes them; `pnpm type:check` and `type-check.yaml` catch it.

## Build

`vite.config.mjs` builds one entry point per run, in library mode, as ESM:
`vite build` builds the renderer and empties `dist/`, and `vite build --mode
main` builds main next to it. The two runs share no chunk; each bundle carries
its own copy of the `src/common/` code it imports. Nothing is minified.
`pnpm build` runs both, and its `postbuild` script runs `pnpm check:dist`.

The main run writes one file: `codeSplitting` is off for it. pi loads its
providers and the libraries of pi-coding-agent with dynamic `import()`; as
chunks, the ones a rebuild leaves unchanged would keep their URL, and a
development reload would take them from Node's module cache, state included.
In one file the reload evaluates all of pi again. pi loads its OAuth login
modules by a runtime path, which does not exist in the bundle, so
`src/main/index.ts` calls `registerBunOAuthFlows()` of
`@earendil-works/pi-ai/bun-oauth` before creating the `ModelRuntime`, which
registers the bundled modules instead.

`pnpm dev` runs the same two builds in watch mode, side by side, for a
directory install: the host reloads the extension when either entry is
rewritten. Its renderer run passes `--no-emptyOutDir`. In watch mode Vite
empties the output directory again before every rebuild, so a renderer rebuild
would delete `dist/main.js`, and the host would have no main entry to reload.
`pnpm dev` does not run `pnpm check:dist`.

`vite.config.mjs` and the plugins in `build/` are the template's
(freelensapp/freelens-example-extension), with `codeSplitting` set per entry,
and `build/vite-plugin-standard-decorators.mjs` is Freelens's own.

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
library it bundles (`lucide-react` and `react-markdown` import `react` too).
Its named exports are the members of the copy installed as a devDependency,
which is pinned to the host's version, so an import of a name the host's
version lacks fails the build. The plugin also fails the build on an import of
a host module that the process does not publish (`react` in main), and on a
subpath of a host package that the host does not publish (`react-dom/client`,
`react/jsx-dev-runtime`). Both would otherwise either read `undefined` at
runtime or bundle a second copy. A second React throws `invalid hook call`; a
second mobx throws nothing, and the host simply never reacts to its
observables.

Everything else is bundled, pi and the provider SDKs it brings included. That
includes `@freelensapp/extensions`, a shim of three lines that reads `Common`,
`Main` and `Renderer` off the same global; it must not be mapped. The host
installs no dependencies of an extension, so whatever the code needs at
runtime and the host does not provide has to be in the bundle.

Every library is a devDependency, bundled or not. A bundled library that
Freelens does not have in its catalog (pi, `loglevel`, `lucide-react`,
`react-markdown`, `remark-gfm`, `typebox`, `yaml`) is named in two more
places: in `ignoreDependencies` of `knip.jsonc`, since the
`--production --strict` pass reports a devDependency imported by production
code as unlisted, and as an exclusion (`!name`) in the "Freelens dependencies"
rule of `.renovaterc.json`, since that rule takes every other version from the
Freelens catalog.

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
  `pnpm type:check` passes either way, and only the load of `dist/main.js` in
  `pnpm check:dist` fails on the wrong platform before Freelens does.
  `process.env.NODE_ENV` stays unreplaced in main, where the logger reads it.

### Decorators and the stores

The extension has no decorator. Its store, `PreferencesStore`
(`src/common/store/`), extends `Common.Store.ExtensionStore`, which the host
persists and syncs between the processes through `toJSON()` and
`fromStore()`. Its fields are plain own fields, made observable by an
annotation map in the constructor, `makeObservable(this, { field: observable,
... })` after `super()`, which runs after the field initializers under
`useDefineForClassFields`; `observableRef` marks the fields that are replaced
as a whole. `toJSON()` returns plain values, since the host structure-clones
the value and a mobx proxy cannot be cloned. `@observable accessor` fields
would move the values to getters on the prototype, and a decorator on a plain
field type-checks but leaves the field unobservable in mobx's production
build.

The host saves a store key by key, so a field only left out of `toJSON()`
stays in the file. The fields of the old OpenAI settings are therefore
written back as `null` once main has imported them into pi, and those of the
old per-tool approval choices once main has moved them into a policy profile
(`src/common/store/legacy-preferences.ts`, `clearLegacy()`).

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

### Checks of the built output

`build/check-built-output.mjs` (`pnpm check:dist`, run by `pnpm build`)
checks what neither the build nor the type check catches, and what only
Freelens would reject at runtime. It exits with 1 and lists every failure:

- `dist/` holds `main.js`, `renderer.js` and `renderer.css`, with their source
  maps, and nothing else;
- `dist/main.js` loads in plain Node with a stand-in
  `globalThis.FreelensExtensionApi`, and its default export is the extension
  class;
- neither bundle reads a v1 host global (`global.LensExtensions`, ...);
- neither bundle imports a host module by its bare id, and neither carries a
  copy of one, found through the source maps (C3);
- the renderer bundle imports no Node builtin or Electron module and has no
  `require(`; the main bundle imports nothing but Node builtins and Electron,
  and calls only the `__require` that Rolldown creates;
- no decorator and no `accessor` field is left unlowered.

It reads the bundles with Vite's `parseAst` rather than searching the text,
since the main bundle has `require(` and decorators in the comments and
strings of the libraries it inlines. The stand-in API of the load has only
what the main bundle reads when it is evaluated: `Main.LensExtension`,
`Main.Ipc`, `Common.Store.ExtensionStore` and the installed mobx. A change
that makes the bundle read another host member at load time, such as a
top-level `extends Main.X` or a top-level call, adds it to `loadMainBundle()`
there. Run it on a fresh build: `pnpm build` empties `dist/` first.

## TypeScript

Main code runs in Node, renderer code in a browser page, and common code in
both. Each is type-checked in a program of its own, so that an API the runtime
does not have fails `pnpm type:check` rather than the extension:

| Config                       | lib                       | types                 | Files                                                              |
| ---------------------------- | ------------------------- | --------------------- | ------------------------------------------------------------------ |
| `src/main/tsconfig.json`     | ES2024                    | `node`                | `src/main/`, `src/common/`                                         |
| `src/renderer/tsconfig.json` | ES2024, DOM, DOM.Iterable | `vite/client`         | `src/renderer/`, `src/common/`                                     |
| `src/common/tsconfig.json`   | ES2024, WebWorker         | none                  | `src/common/`                                                      |
| `src/tsconfig.json`          | ES2024, DOM, DOM.Iterable | `node`, `vite/client` | `*.test.ts(x)` under `src/`, and `test/`                           |
| `tsconfig.json`              | ES2024                    | `node`                | `vite.config.mjs`, `vitest.config.ts`, `svgo.config.mjs`, `build/` |

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
processes need lives in `src/common/`, and whatever imports React, the DOM,
Node or pi stays in the process that has it.

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
declaration with `pnpm patch`. pi's declarations leak Node (through
`@anthropic-ai/sdk`, `openai` and `undici-types`), which is why only main
imports pi. The libraries the renderer and common code import
(`react-markdown`, `remark-gfm`, `lucide-react`, `typebox`, `loglevel`) leak
neither today.

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

- an in-memory `Common.Store.ExtensionStore`, a singleton per class, with
  `resetInstance()` between tests;
- `Main.LensExtension` with the host's order of the lifecycle: `activate()`
  runs `onActivate`, and `disable()` awaits `onDeactivate`, then runs the
  disposers of what the extension registered; its `getExtensionFileFolder()`
  throws until a test points it at a temporary folder with `vi.spyOn`;
- `Main.Ipc`, one instance per subclass, whose `handle` keeps the handlers in
  the exported `ipcMainHandlers` map, so a test invokes one as a frame would;
  a second handler for a channel throws, as in Electron, and `disable()`
  removes them, as the host does; `broadcast` sends nothing, and a test spies
  on it;
- `Renderer.LensExtension`, the same lifecycle as `Main.LensExtension`, and
  `Renderer.Ipc`, one instance per subclass, whose `listen` keeps the
  listeners in the exported `ipcRendererListeners` map, so a test broadcasts
  to them as main would, and whose `invoke` calls the handler in
  `ipcMainHandlers`; `disable()` drops the instance and its listeners, as the
  host does;
- `Renderer.K8sApi.menuItemFor`, which returns the registration with the
  components it is given;
- `Common.Catalog.KubernetesCluster`, the cluster entity a settings tab's
  view receives, with the host's static `apiVersion` and `kind`, made from
  its `metadata`, `spec` and `status`, whose `getId()` is `metadata.uid`;
- `vi.fn()` stand-ins for `Common.logger`, `Main.Catalog.getClusterById`,
  `Main.Catalog.getAllClusters`, `Renderer.Catalog.getAllClusters`,
  `Main.Shell.getEnvironment`, `Main.Shell.getKubectlPath`,
  `Main.Util.fetch` and the terminal of `Renderer.Component`;
- plain DOM stand-ins for the host components the views render (`Button`,
  `Icon`, `Switch`, `HorizontalLine`, `SubTitle`, `MonacoEditor`, which shows
  its value as text, `Input`, which passes its `aria-label`, `onFocus` and
  `onBlur`, and `Select`, a group named by its `aria-label` with a button per
  option, the option of its `value` pressed, and one that clears it with
  `null`).

Extend it when a test needs more of the host; it is runtime only, the types
stay the real declaration's. knip does not follow the alias, so the stub is an
entry of `knip.jsonc`.

`test/stand-in-cli.ts` is a stand-in CLI runner for the `kubectl` and `helm`
tools of the agent host: `createStandInCli({ answers, hang, progress })` records every CLI
invocation (`invocations`: cluster id, program, arguments, manifest, timeout
and signal) and answers it by its arguments joined with spaces
(`"get pods -n web"`) with standard output, standard error and exit code; an
invocation without an answer exits with 1. `actions()` leaves out the approval
gate's own invocations: its reads of the cluster's resources and namespace,
which answer by default with the resources of `STAND_IN_RESOURCES` and no
namespace, and its dry-run previews, which `previews()` returns (the dry runs,
kubectl's `get <resource> <name> -n <ns> -o yaml` reads of the current objects,
and helm's `get manifest <release> -n <ns> [--revision <n>]` and
`history <release> -n <ns> --max 1 -o json` reads of a release). The answers
are keyed by the arguments alone, whatever the program.
`hang` leaves the given invocations running until their signal aborts, and
`progress` sets the messages the first invocation reports, as a kubectl
download does.
`test/fake-kubectl.mjs` is a fake kubectl, a Node script that the extension
entry test runs through the real CLI runner (its header lists what its
arguments make it do).

The agent host tests (`src/main/agent/agent-host.test.ts`) drive the host
through `handleCommand(clusterId, command)` with pi's faux provider as the
model (`fauxProvider` of `@earendil-works/pi-ai`), the stand-in CLI and the
envelopes of the `broadcast` callback. The faux provider's response
factory receives the request options, so a test asserts on the `fetch` a
request carries. The extension entry test (`src/main/index.test.ts`) drives
`LensExtensionAiMain` in the host's order on the stub, with the faux provider
registered on the `ModelRuntime` the entry creates (a spy on
`ModelRuntime.create`): a deactivation and a new activation leave one handler
per IPC channel and one agent host, and a deactivation during a run stops it
without an error. Its `Main.Shell` stand-in returns the path of the fake
kubectl, for helm too, the only test that starts a process. It spies on `console.error` in
`vi.hoisted`, because loglevel
binds the console methods when its level is set, at import.

The root `tsconfig.json` checks the tooling files. It has `checkJs`, so the
Vite config, the build plugins and `build/check-built-output.mjs` are
type-checked too; give their function parameters JSDoc types.

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

Biome does not read SCSS; Trunk formats it with Prettier. Trunk also runs
markdownlint with the rules of `.markdownlint.yaml`, and its `lint.ignore`
leaves out `.claude/skills/**`, the agent skills vendored as they are.

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
`build/check-built-output.mjs` is found through the `check:dist` script.

### Workflows

| Workflow                 | Runs                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `type-check.yaml`        | `pnpm type:check`                                                                    |
| `check.yaml`             | `pnpm build` (with `pnpm check:dist`), `pnpm lint:check`, `pnpm knip:check`          |
| `unit-tests.yaml`        | `pnpm test:unit`                                                                     |
| `trunk-check.yaml`       | `trunk check` over every file (`check-mode: all`)                                    |
| `integration-tests.yaml` | the integration tests in `integration/`, against a Freelens build of `main`          |
| `mise-lock-check.yaml`   | on a change to `mise.lock`: no checksum changed for an unchanged tool version        |
| `release.yaml`           | on a tag: build, pack, publish to npm, the release with `.tgz` and `.sha256`         |

The type check has a workflow of its own, on pull requests and on pushes to
`main`, as in Freelens. It runs every program, tests, tooling and environment
tests included, which no build reaches, and a type error shows as its own
failed check rather than as a failed build. `check.yaml` builds without the
type check for the same reason, so it does not run twice. `check`,
`type-check`, `unit-tests`, `integration-tests` and `trunk-check` can also be
started by hand (`gh workflow run <file> --ref <branch>`). `pnpm trunk:check`
checks only modified files, so run `pnpm trunk:check:all` before pushing, as
the workflow does.

The integration tests run inside a Freelens checkout: the workflow builds the
extension, packs it with a `.tgz.sha256` checksum next to the tarball, as the
release publishes it, checks out and packages Freelens, copies
`integration/__tests__/` into the `integration/__tests__/` of its app package
(`freelens/freelens/`) and runs them there under Freelens's Vitest, with its
helpers, against a KinD cluster. `extensions.tests.ts` is one
session: the app installs the tarball from the extensions page, fails on any
error logged by either process, and opens the extension's preferences, which
show the title "Freelens AI Settings" and the "Thinking level" label. The
tests are deterministic, so the workflow passes `--retry=0` and runs the step
once. The code the session uses is in
`integration/__tests__/extension-helpers.ts`, whose name does not match
`*.tests.ts`, so Freelens's Vitest does not collect it; the directory stays
flat, because the workflow copies it with `cp integration/__tests__/*`.

## The pi agent

The chat is one pi agent (`@earendil-works/pi-coding-agent`) in the **main
process**, with one pi session per cluster. The cluster frames talk to it
over Freelens IPC and only show the chat and the approval cards; the API keys,
the logins, the model requests and the CLI invocations never leave main. Model
ids, prices, context windows and the thinking level come from pi's catalog;
there is no model list or capability heuristic of our own. When changing the protocol, the reducer, the host or a
tool, add or adjust the matching `*.test.ts` (run with `pnpm test:unit`).

### The agent host

`src/main/agent/agent-host.ts` holds the sessions of every cluster, keyed by
the cluster id each command carries. It imports nothing from Freelens: the
entry hands it what it needs as options (`AgentHostOptions`), read when they
are used, so a changed preference applies to the next prompt or tool call,
and its tests pass stand-ins.

- **Sessions.** A cluster's chat is a pi session saved as JSONL in
  `<extension folder>/sessions/<clusterId>/`, continued after a restart. New
  chat starts a new file, and Delete all chats removes the cluster's folder.
  `pruneSessions()` deletes chats not changed for `chatRetentionDays` (0 keeps
  them), at startup and on New chat, and keeps the active chat of each
  cluster. pi's own files are in `<extension folder>/pi/`.
- **Only our prompt and tools.** Each session is created with
  `DefaultResourceLoader` turned off for pi's extensions, skills, prompt
  templates, themes and context files, the system prompt of
  `src/main/agent/system-prompt.ts`, and `noTools: "builtin"`; an inline
  extension registers the `kubectl` and `helm` tools and the hooks below. The
  prompt says that the agent runs kubectl and helm through the two tools,
  within the floor and the profile, keeps the output small with `grep`,
  selectors and `-o`, and changes a workload that helm manages through helm.
- **Prompt sections.** pi's `before_agent_start` hook sets the `cluster`
  section (the cluster's name in the catalog), the `user_rules` section (the
  custom agent rules) and the `cli_policy` section (the cluster's policy
  profile, its rules and fallback level, and the floor) before every run,
  whether a user message or a custom message started it.
- **AI Explain.** The `explain` command runs in a throwaway in-memory session
  with `EXPLAIN_PROMPT` and the user's rules and no tools. It streams as
  `event` envelopes under its own `sessionId` and is never saved.
- **Approvals** are pi's `tool_call` hook (see "Approvals").
- **Stop** (`abort`) aborts the run, the CLI invocation in progress and a
  pending approval, which is denied.

### The IPC protocol

The frames talk to the agent over Freelens IPC, not a local HTTP bridge
(`docs/adr/0001-frames-talk-to-the-agent-over-ipc.md`).
`src/common/agent-protocol.ts` defines it:

- **Commands** go from a frame to main with `Renderer.Ipc.invoke` on
  `AGENT_COMMAND_CHANNEL`, with the frame's cluster id: `prompt`, `explain`,
  `abort`, `get_snapshot`, `get_session_stats`, `new_session`,
  `delete_sessions`, `ui_response` (an approval answer) and
  `set_auto_approve`. Main answers each with pi's RPC response shape
  (`AgentResponse`).
- **Envelopes** (`{ clusterId, sessionId, seq, kind, payload }`) go from main
  to every frame with `Main.Ipc.broadcast` on `AGENT_ENVELOPE_CHANNEL`; each
  frame keeps only its own cluster's. `kind` is `event` (pi's session events
  as its RPC mode sends them), `ui_request` and `ui_resolved` (an approval and
  its answer), `auto_approve` and `stats` (tokens, cost, context usage). `seq`
  increases by one for every envelope of a cluster.
- **The snapshot** (`get_snapshot`) has everything a frame needs to show the
  chat when it opens or remounts, even mid-run: the transcript with its tool
  results and compaction markers, the answer being streamed, the pending
  approval with its dry-run preview, "Approve all in this chat" and the stats, and the
  `seq` of the last envelope. The frame then applies only envelopes with a
  higher `seq`, and loads a new snapshot when it sees a gap.

pi's types are declared in the protocol rather than imported (see "pi in main
only"): the content parts, the message roles, the assistant message events,
`JsonAgentSessionEvent`, `ContextUsage` and `SessionStats`, each with the
fields the frames and the agent host's tests read, and the event types and
roles the frames ignore listed by name. Main sends pi's objects unchanged, and
the agent host's type check holds them to these declarations: an event type or
a role pi adds fails `pnpm type:check:sources` until it is listed. When a
frame starts reading more of an event or a message, add the field there.

`src/common/provider-protocol.ts` is the second protocol, global rather than
per cluster: `PROVIDER_COMMAND_CHANNEL` and `PROVIDER_ENVELOPE_CHANNEL`, for
provider status, models, logins and custom endpoints (see "Providers and
models").

The frame side is `src/renderer/business/agent-client/`. `agent-client.ts`
starts once per cluster frame (`startAgentClient`; the root frame receives the
same broadcasts and ignores them, as it has no cluster id), buffers the
envelopes that arrive while a snapshot is on its way, and sends the commands.
`chat-reducer.ts` folds a snapshot and the envelopes into the chat the views
show, a tool call from its `tool_execution_*` events or from the snapshot's
tool-call parts and tool results; it is pure and tested on its own. The
frame's cluster id is read from its host name
(`src/renderer/business/cluster/frame-cluster-id.ts`), as Freelens reads it.

### CLI invocations in the main process

The agent reaches the cluster through two tools, `kubectl` and `helm`, each of
which runs a CLI invocation of the real binary against the chat's cluster, in
main (`docs/adr/0003-agent-tools-are-cli-invocations.md`, which supersedes ADR
0002 for how the tools reach the cluster).

The tools are defined once, in `src/common/agent-tools/kubectl-tool.ts` and
`helm-tool.ts`: name, label, description and the same typebox `parameters`
(`cliToolParameters`: `args`, `manifest`, `grep`, `timeoutSeconds`,
`revealSecrets`). `AGENT_TOOLS` lists them, and the renderer reads them for
the chat's tool list. In main, `toPiTool` wraps each as a pi tool with
`executionMode: "sequential"`, so pi runs the calls of a batch one at a time
and asks an approval only after the previous call has finished; there is no
read or write classification. `runCliTool` of `tools/cli-tool.ts` turns a call
into an invocation for the runner, and its result into what the model reads.

- **The runner.** `createCliRunner` of `src/main/agent/cli-runner.ts`, which
  the entry passes as the `runCli` option, runs the kubectl of
  `Main.Shell.getKubectlPath(clusterId)`, the one Freelens downloads for the
  cluster's version, or the helm of `Main.Shell.getHelmPath(clusterId)`,
  with `execFile`, the argument array and the environment
  of `Main.Shell.getEnvironment(clusterId)`, which reaches the cluster through
  Freelens. No shell is involved (see "`execFile`, never a shell"), and only
  the manifest goes on standard input. The download's phases and progress come
  back through `onProgress`, and the tool card shows them. Output of more than
  64 MiB on a stream kills the process.
- **The cluster.** Before every call, the gate and the tool ask
  `getClusterStatus(clusterId)` (the catalog's `status`). Anything but
  `"connected"`, a cluster Freelens does not know included, is the error
  result "Cluster not connected", and no process starts: a tool never
  connects a cluster.
- **What runs.** The agent's arguments. For kubectl, `-f -` is added for a
  `manifest`, and `--tail=<pod logs tail lines preference>` to a `logs`
  without `--tail`, `--since` or `--since-time`; the arguments after `--`
  belong to the command of `exec` and are left alone. helm takes no manifest.
- **Timeout and Stop.** 30 seconds when `timeoutSeconds` is unset, at most
  300. Stop aborts pi's signal, which kills the process, and the timeout kills
  it too; the result says which of the two did. A kubectl download in
  progress is not cancelled: Stop takes effect once the path comes back. A
  helm killed in the middle of an upgrade leaves the release pending, so the
  helm tool's description asks for a `timeoutSeconds` on its changes.
- **The result.** The model reads the exit code, the standard output and,
  when present, the standard error; a non-zero exit code makes it an error
  result. `grep` keeps the lines of the standard output that match it, then
  the output is capped at 256 KiB, keeping its head and tail with a marker of
  how much was cut. The result's `details` (`CliInvocationDetails`) carry the
  arguments that ran and the exit code, which the tool card shows.
- **Secret redaction** (`tools/secret-redaction.ts`). A `get` whose targets
  include `secrets`, without `revealSecrets`, runs with `-o json` in place of
  the agent's output format. In every object of kind Secret, each value of
  `data` and `stringData`, and the annotation
  `kubectl.kubernetes.io/last-applied-configuration`, which holds a copy of
  them, becomes its size (`redacted, 8 bytes`). The result is printed as YAML
  when the agent asked for `yaml` or `kyaml`, as JSON otherwise, with a line
  that says the values are redacted; an output that is not JSON is withheld.
  Table output (no `-o`, `-o wide`, `-o name`) runs as asked. A `describe`
  of Secrets, which prints the token of a service-account token Secret in
  full, is rejected by the floor without `revealSecrets`. With
  `revealSecrets` the call runs as asked, and the profile decides about its
  `reveal` targets. Nothing outside Secret objects is redacted.
- **Secrets in a release's manifest.** The output of helm `get manifest`,
  `status`, `upgrade` and `rollback`, which can carry the rendered manifest
  (with `--dry-run` or `--debug`), has the Secret documents redacted the same
  way, after their `# Source:` comment and printed as YAML; a Secret document
  that does not parse is withheld, and the note is added only when a Secret
  was found. The parts are split at `---` and at the headings of helm's table
  output (`HOOKS:`, `MANIFEST:`, `NOTES:`). `status -o json` or `-o yaml`,
  which prints the release as one object, is rejected by the floor without
  `revealSecrets`. With `revealSecrets`, `get manifest` and `status` have the
  verb `reveal`, and `upgrade` and `rollback` get a `reveal` form next to
  their own. Helm values (`get values`) are not redacted.

### Approvals

pi's `tool_call` hook (`AgentHost#gate`) runs before every call, with the
invocation policy of `src/common/invocation-policy/`, a pure module that
reaches no Node, pi or DOM API.

- **The policy.** `evaluateInvocationPolicy` takes the program, the agent's
  own arguments (before `-f -` or a logs tail), the manifest,
  `revealSecrets`, the cluster's policy profile, the resource catalog and the
  default namespace. It returns a floor rejection with its entry
  (`FLOOR_ENTRIES` of `floor.ts`), or one canonical form per target with the
  level and the rule that gave it, and the most restrictive of those levels.
  Both programs share the parser of `cli-invocation.ts`, over the command
  table of each (`kubectl-commands.ts`, `helm-commands.ts`, taken from their
  `--help`), which accepts only the flags it lists. helm's canonical forms
  (`helm-canonical-forms.ts`) have the resource `releases`, with the release
  as the name, or `charts` for `show` and `search repo`; a chart is named only
  as `<repository>/<chart>`, and `upgrade` takes only `--reuse-values`, which
  it needs, `--set` and `--dry-run`.
- **The cluster's resources.** Before the chat's first call, of either tool, the gate runs
  `kubectl api-resources -o wide` and
  `kubectl config view --minify -o jsonpath={..namespace}`
  (`tools/cluster-resources.ts`) through the same runner and pi's signal, and
  keeps the catalog and the namespace (else `default`) for the chat's
  session. A resource the catalog lacks reads it again once; a catalog that
  cannot be read blocks the call.
- **The profile.** The host resolves it per call from the
  `getPolicyProfileSettings` option (`clusterPolicyProfile` of
  `profile-assignment.ts`): the profile assigned to the cluster, else the
  default profile, else Standard. The shipped profiles (Read only, Standard,
  Permissive) live in `shipped-profiles.ts`; `PreferencesStore` holds the
  user profiles, the assignments and the default profile id.
- **The levels.** A floor rejection or Deny blocks the call with the reason
  (`tools/block-reasons.ts`), which the model gets as the tool's result and
  the tool card shows. Allow lets it run. Ask asks the user unless "Approve
  all in this chat" is on; Always ask always asks, and its card does not offer
  "Approve all in this chat". The gate records every call it lets through in
  `passedCliCalls`, with its program and its Secret redaction, and a tool
  runs only a call of its program recorded there.
- **The dry run.** Before asking about a call whose verb is on
  `DRY_RUN_VERBS` (`dry-run-verbs.ts`), `previewKubectlInvocation`
  (`tools/kubectl-preview.ts`) runs it with `--dry-run=server` and `-o yaml`
  (`-o name` for `delete`, no `-o` for `cordon`, `uncordon` and `drain`), then
  reads each named target with `get <resource> <name> [-n <ns>] -o yaml`. A
  dry run the server rejects (Invalid, Forbidden, NotFound, AlreadyExists,
  Conflict, or an admission webhook that denied it) blocks the call with the
  server's message, and nobody is asked. Any other failure is "Preview
  unavailable" with the reason, and the current YAML of the named targets as
  the backup. Otherwise the card shows a diff per target, current against dry
  run, without managed fields (`line-diff.ts`). For helm `upgrade` and
  `rollback`, `previewHelmInvocation` (`tools/helm-preview.ts`) runs the call
  with helm's own `--dry-run=server` (and `-o json` for `upgrade`), reads the
  release's manifest with `get manifest`, and diffs it against the manifest
  of the release the upgrade's dry run prints, or for a rollback, which
  prints none, against `get manifest --revision <n>` of the revision it goes
  back to (the one it names, else the latest of `history --max 1 -o json`
  minus one, as helm takes it). A dry run that fails the way the call would
  (a release or revision that does not exist, a chart that does not render,
  invalid or rejected objects) blocks the call; any other failure is "Preview
  unavailable" with the current manifest as the backup. Neither Allow nor a call that
  "Approve all in this chat" lets through gets a dry run. The preview reaches
  the card only, never the model or the chat's file.
- **The request.** The `CliApprovalRequest` (the program, the agent's own
  arguments, the manifest, the canonical forms, the level, the profile's name
  and the preview) goes out as a `ui_request` envelope and stays in the
  snapshot until it is answered, so a remounted frame shows the card again.
  The frame answers with `ui_response`; main broadcasts `ui_resolved`. A
  denied call is blocked with `DENIED_REASON`, which the model gets as the
  tool's result.
- **A profile change.** Main checks every pending approval again
  (`recheckPendingApprovals()`) when the user profiles, the assignments or
  the default profile are replaced: one the new profile denies, or the floor
  rejects, is denied with the reason; any other stays pending, and one whose
  level or profile changed is sent again as a `ui_request` with the same id,
  which updates the card (Allow shows as Ask), so the answer is gated on the
  current level. The gate also evaluates the call again right before it sends
  the request, so a profile changed during the dry run applies.
- Stop, New chat, Delete all chats and a deactivation deny a pending
  approval; Stop during the dry run blocks the call without a card.
- "Approve all in this chat" (`approveAll` on the answer to an Ask approval)
  is kept in memory only, so New chat, Delete all chats and a restart turn it
  off.

At startup main turns the old per-tool approval choices
(`toolApprovalOverrides`, `podLogsRequireApproval`) that differ from the old
tools' defaults into the user profile "Standard (migrated)", the new default
profile (`src/common/store/approval-migration.ts`), and writes the old fields
back as `null`.

### Providers and models

`src/main/agent/provider-service.ts` serves the provider protocol on pi's
`ModelRuntime`: the providers pi supports with their status and models,
logins with an API key or OAuth, logout, and custom OpenAI-compatible
endpoints (`custom-providers.ts`). A login's prompts (a sign-in URL, a device
code, a text or secret field) go out as envelopes and come back as
`ui_response` commands, as the chat's approvals do. Credentials live in pi's
own files, `<extension folder>/pi/auth.json` and `models.json`, and never
leave main. The renderer side is `src/renderer/business/provider-client/`,
used by the settings page in the root frame and by the chat's model picker in
each cluster frame.

The chat runs on the model of `agentModel` (`provider/id`), which the model
picker writes; the thinking level is global (`thinkingLevel`), and pi clamps it
to what the model supports. At startup `src/main/index.ts` moves the old
OpenAI key and custom base URL into pi once (`credentials-import.ts`, each with
a marker file), then clears the old fields (see "Decorators and the stores"),
and carries a key saved for pi's renamed Azure provider over
(`azure-rename.ts`).

### HTTP from main

The model requests go through `Main.Util.fetch`, the host's HTTP client, so
the user's HTTPS proxy, CA certificates and "allow untrusted CAs"
preferences apply to them. The agent host takes a `fetch` option, which the
entry sets to `(input, init) => Main.Util.fetch(input, init)`, read when each
request is sent, since the namespace exists only once the extension is
loaded. pi has no session-level `fetch` option, so `useInjectedFetch(session)`
wraps `session.agent.streamFunction` right after each `createAgentSession`
(the chat's in `createClusterAgent`, AI Explain's in `explain`) and adds
`fetch` to the options of every model request. The chat's runs, its
compaction summaries and pi's prompt-cache warmer all send through it. Nothing
replaces the global `fetch` or the global undici dispatcher of the main
process. The renderer sends no HTTP request of its own.

These requests stay on Node's own HTTP, without the Freelens proxy and CA
preferences:

- models on the `google-generative-ai` and `google-vertex` APIs
  (`APIS_WITHOUT_CUSTOM_FETCH`): pi's two adapters throw "Custom fetch is not
  supported" when given a `fetch` other than the global one, so the wrapper
  leaves their requests alone;
- models on `bedrock-converse-stream`: the AWS SDK sends them through its own
  Node HTTP handler and ignores `fetch`; pi gives it a proxy only from the
  `HTTPS_PROXY` and `HTTP_PROXY` environment variables;
- the WebSocket transport of `openai-codex-responses`, which pi tries first
  under its default `transport: "auto"` before SSE over `fetch`; it too takes
  its proxy only from the environment;
- OAuth logins and token refreshes, and model-list refreshes, which pi sends
  with the global `fetch` directly, outside the stream function.

Closing these gaps needs a runtime-level `fetch` option in pi. The tests in
`describe("model requests through the injected fetch")` of
`agent-host.test.ts` check that the injected `fetch` reaches the request
options of a chat run, an explanation and a compaction, and that a model on
either Google API gets none; `src/main/index.test.ts` checks that a chat
request reaches the stub's `Main.Util.fetch`.

### Lifecycle

`onActivate` of the main extension loads `PreferencesStore`, creates pi's
`ModelRuntime`, runs the one-time imports, starts the provider service and the
agent host, and registers the two IPC handlers. `onDeactivate` disposes both:
every pending approval is denied, every session and explanation disposed,
which ends its run, and a login in progress cancelled. The host removes the
IPC handlers when the extension is disabled, so a reload leaves one agent host
and one handler per channel. Do not keep a session, a timer, a run or a login
in module state that `onDeactivate` cannot reach.

The renderer extension's `onDeactivate` stops the agent client and the
provider client (`IpcConnection` of `src/renderer/business/ipc-connection.ts`
holds each one's `Renderer.Ipc` and listener). The host drops their
`Renderer.Ipc` instances and listeners on Disable, and Enable activates the
module already loaded again, so a client left connected would receive no
envelopes; stopped, it connects again and loads a new snapshot.

The main process logs through loglevel, `const { log } = useLog("freelens-ai")`
of `src/main/utils/logger.ts`, which prefixes the scope; it does not call
`console.*` itself. Neither does the renderer: its views use the `useLog`
hook of `src/renderer/utils/logger/`, and code outside a component
`createLogger` of `src/common/utils/logger.ts` with `RENDERER_LOG_LEVEL`.

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
  Flux and workloads deployed by it), and a provider connected in the
  preferences: an API key, an OAuth login, or a custom OpenAI-compatible
  endpoint such as LiteLLM. A model is chosen in the chat's model picker.
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
- **Main.** The agent host, the provider service, the model requests and the
  CLI invocations run in main and log there with the `freelens-ai` scope: in the
  terminal running Freelens, and in its log file (on macOS
  `~/Library/Logs/Freelens/lens.log`). The chats are the JSONL files in the
  extension's `sessions/` folder.
- **Disabling and enabling.** Without a restart of Freelens, disabling and
  enabling the extension leaves two instances of its store in main
  (freelensapp/freelens#2721). Restart Freelens after enabling it again;
  rebuilds are not affected.

## Code Style

- **Biome** formats **TypeScript/TSX, JavaScript and JSON**: double quotes, semicolons, trailing commas, 2-space indent, 120 char line width
- **Trunk** formats **Markdown, YAML, SCSS** (with Prettier), and other formats not covered by biome — use `pnpm trunk:fix`
- Import order (enforced by biome organizeImports): built-in modules → `@freelensapp/**` → packages → relative paths
- React 19, provided by the Freelens host
- **No emoji** in Markdown files (`.md`), comments, or any source code
- **No `as any`, no `globalThis.require`, no host internals.** A gap in Freelens, the template or pi is reported upstream, not worked around

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

- **Main process** (`src/main/`) — Node.js environment, extension lifecycle, the pi agent, the CLI invocations and the model requests
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
5. A failure after the bundles are written comes from `pnpm check:dist`; its list names each rule the output breaks (see "Checks of the built output")

### Runtime Errors

1. Open Freelens DevTools and check the Console tab for renderer errors; the chat runs in the cluster frame, the preferences in the root frame
2. Check the terminal where Freelens was launched for main process errors: the agent host, the provider service, the model requests and the CLI invocations run there
3. Look for stack traces with file:line numbers
4. Check the change against "Rules That Fail Silently"
5. Validate both with `pnpm type:check` **and** `pnpm build` — runtime failures can appear only in bundled `dist/` code

## Best Practices

1. **Use semantic search** to find examples and patterns in the codebase
2. **Follow existing patterns** — grep for similar implementations before creating new ones
3. **Test changes** before committing
4. **Run validation before committing:** `pnpm lint:fix && pnpm type:check && pnpm test:unit`
5. **For TypeScript/TSX, JavaScript and JSON files:** run `pnpm biome:fix` (or `biome check` directly if `biome` is installed locally)
6. **For Markdown, YAML, SCSS and other formats:** run `pnpm trunk:fix` (or `trunk check` directly if `trunk` is installed locally), and `pnpm trunk:check:all` before pushing
7. **Full build** when in doubt about cached state: `pnpm clean:all && pnpm install && pnpm build`
8. **Do not use Anthropic Fable for coding tasks** — Fable may be used only for planning,
   analysis, and thinking through problems. When writing or editing code,
   use standard editing tools instead.

## Agent skills

### Issue tracker

Issues and specs are local markdown files under `.scratch/<feature-slug>/`, committed with the code. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

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

     ````suggestion
     <same unified-diff format as shown above>
     ````

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
