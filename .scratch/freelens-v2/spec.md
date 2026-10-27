# Spec: the pi agent on the Freelens v2 extension API

Status: ready-for-agent

Source: the grilling session that planned the port, the
`port-freelens-extension-to-v2` skill of freelensapp/freelens-example-extension
and the documents it links (`migrating-from-v1.md`, `api.md` C1 to C15, the
template's `AGENTS.md`), the v2 port already done on the `main` branch
(freelensapp/freelens-ai-extension#292, #298, #306), ADR 0001 (frames talk to
the agent over Freelens IPC) and ADR 0002 (cluster tools run in the main
process).

Wording: the **`main` branch** is the git branch; the **main process** is the
Electron process. The **pi agent branch** is `piagent`, the branch of PR #290.

## Problem Statement

The pi agent branch is built for the Freelens v1 extension API. Its manifest
asks for Freelens `^1.4.0`, so Freelens 2.x refuses the extension at discovery,
before any of its code runs, and a user on Freelens 2 cannot use the pi chat at
all. The `main` branch already runs on v2, but with the LangChain agent that the
pi agent branch replaces, so neither branch gives a Freelens 2 user the pi
agent.

The pi agent branch also carries limits that only v1 forced on it:

- Every cluster tool call travels from the main process to the cluster frame
  and back, because the v1 main-process API could not reach pod logs,
  subresources or kinds with irregular plurals. A call can time out after 30
  seconds, a frame that reloads while a write is pending leaves its outcome
  unknown, and the tools load objects into the stores the UI shows.
- The renderer reaches into host internals: it calls Electron's `ipcRenderer`
  on a host channel to open the preferences, and casts its way into the
  protected request client of a `KubeApi`.
- pi sends its model requests with Node's built-in `fetch`, so the chat ignores
  the Freelens HTTPS proxy and CA certificate preferences and fails in a
  corporate network where Freelens itself works.
- pi is at 1.0.0 while 1.4.0 is out.

## Solution

The extension loads and runs on Freelens 2.x with the pi chat the user knows:
the same chat page per cluster, streaming answers, approvals, providers and
logins, AI Explain and preferences. Underneath:

- The build, the TypeScript layout, the tests, the lint and the CI follow the
  Freelens v2 stack, with the same files and versions as the `main` branch.
- The cluster tools run in the main process and reach the cluster through
  Freelens, by path, so they no longer depend on the cluster frame for anything
  but the approval card.
- pi's model requests go through the Freelens HTTP client, so the proxy and CA
  preferences apply to the chat.
- pi is upgraded to 1.4.0.
- A developer installs the extension from its directory and sees a rebuild
  reload it without restarting Freelens.
- The work ends with a list of manual test cases that the maintainer follows in
  Freelens v2, and with the `main` branch merged into the pi agent branch so
  that PR #290 can land.

## User Stories

Installing and loading

1. As a Freelens 2 user, I want the extension accepted when I install it, so
   that I can use the AI chat on the current Freelens.
2. As a Freelens 2 user, I want the extension to load without errors in either
   process, so that nothing else in Freelens is disturbed by it.
3. As a Freelens 1 user, I accept that this version does not install on my
   Freelens, so that the extension can use the v2 API without fallbacks.
4. As a user upgrading from 0.7.1, I want my OpenAI key, custom base URL and
   model choice still carried over into pi, so that the assistant works right
   after the update.
5. As a user, I want the extension's styles to apply in the light and the dark
   theme, so that the chat and the preferences look like the rest of Freelens.

Chatting

6. As a cluster operator, I want the "Freelens AI" entry in the cluster menu,
   with its icon, to open the chat page, so that I find the assistant where it
   was.
7. As a cluster operator, I want to ask about the cluster open in this frame,
   so that answers are grounded in that cluster.
8. As a cluster operator, I want the answer to stream in as it is generated,
   with the model's reasoning when the model gives it, so that I can follow it.
9. As a cluster operator, I want each tool call and its result in the
   transcript, so that I know what the assistant looked at or changed.
10. As a cluster operator, I want Stop to end a run, including a cluster request
    that is still in progress, so that nothing keeps running after I stopped
    it.
11. As a cluster operator, I want the chat restored as it was when I reopen the
    cluster frame, even mid-run, so that I lose neither a partial answer nor a
    pending approval.
12. As a cluster operator, I want my chat to survive a restart of Freelens, so
    that I can continue the conversation.
13. As a cluster operator with several clusters open, I want each cluster
    frame to show only its own chat, so that conversations never mix.
14. As a cluster operator, I want tokens, cost, the context gauge and the
    compaction line to keep working, so that I can watch spending.
15. As a cluster operator, I want New chat and Delete all chats to work as
    before, so that I can start fresh or remove sensitive output.
16. As a cluster operator, I want the "Connect a provider" link in an
    unconfigured chat to open this extension's preferences tab, so that I can
    set up a provider from the chat.
17. As a cluster operator, I want code blocks rendered in the Freelens editor,
    with Copy, Run in a terminal and the managed fields toggle, so that I can
    reuse what the assistant shows.

Cluster tools

18. As a cluster operator, I want the assistant to list namespaces, read the
    cluster version and read the warning events of a namespace, so that it can
    orient itself.
19. As a cluster operator, I want the assistant to list and read any kind the
    cluster serves, custom resources and irregular plurals included, so that it
    is not limited to built-in kinds.
20. As a cluster operator, I want pod logs read from the running container
    unless the assistant asks for the previous one, so that I do not get the
    logs of a terminated container by mistake.
21. As a cluster operator, I want the pod logs filter and the tail lines
    preference followed, so that a chatty pod does not flood the answer.
22. As a cluster operator, I want the assistant to create, update and patch
    resources, scale through a subresource, delete resources, delete pods
    (evict, force, with finalizers) and restart deployments, daemon sets and
    stateful sets, so that it can fix what it finds.
23. As a cluster operator, I want "delete a pod with its finalizers" to really
    remove the finalizers, and the assistant to report what the cluster did, so
    that a pod stuck in Terminating goes away and I am never told otherwise.
24. As a cluster operator, I want a tool on a cluster that is not connected to
    answer "cluster not connected", so that the assistant does not connect a
    cluster I left disconnected.
25. As a cluster operator, I want the tools to keep working when the cluster
    frame reloads in the middle of a run, so that a reload never leaves a change
    in an unknown state.
26. As a cluster operator, I want the assistant's reads to leave the lists I am
    looking at in Freelens alone, so that my views do not change because the
    assistant looked something up.
27. As a cluster operator, I want a failed request explained in plain words
    (forbidden, not found, unavailable), so that I and the assistant know what
    went wrong.

Approvals

28. As a cluster operator, I want every change to wait for my approval by
    default, so that nothing changes without my consent.
29. As a cluster operator, I want the approval card to show the change and the
    current YAML of the resource as a backup, together, so that I can undo the
    change later.
30. As a cluster operator, I want approve, deny, "Approve all in this chat" and
    the per-tool approval settings to work as before, so that I keep the same
    control.
31. As a cluster operator, I want Stop and New chat to deny a pending approval,
    so that nothing is applied after I moved on.

Providers, models and network

32. As a user, I want to connect any pi provider with an API key or a
    subscription login, so that I am not tied to one vendor.
33. As a user, I want the sign-in page of a login to open in my browser, so that
    I can finish an OAuth login.
34. As a user, I want my connected providers, custom OpenAI-compatible
    endpoints and environment-variable keys shown as before, so that nothing
    of my setup is lost.
35. As a user behind a corporate HTTPS proxy, or with a company CA, I want the
    chat to use the proxy and certificates I set in Freelens, so that it works
    wherever Freelens works.
36. As a user of a Google provider, I want to know that its requests do not go
    through the Freelens proxy settings, so that I am not surprised by it.
37. As a user, I want my keys and tokens kept in the main process, so that no
    cluster frame sees them.
38. As a cluster operator, I want the model picker in the chat and the global
    thinking level to work as before, so that I choose model and depth the same
    way.
39. As a user, I want the fixes and provider updates of pi 1.4.0, so that the
    chat benefits from the current pi.

AI Explain and preferences

40. As a cluster operator, I want "Explain" on a warning event to open the chat
    with the event and its explanation, so that I get a quick diagnosis.
41. As a user, I want every preference (providers, thinking level, custom agent
    rules, per-tool approvals, pod logs tail lines, chat retention) shown,
    saved and followed by the chat without reopening it, so that settings take
    effect right away.
42. As a user, I want an error in the chat page, the Explain menu item or the
    preferences to stay inside it, so that the rest of the cluster view keeps
    working.

Developers and maintainers

43. As a developer, I want to install the extension from its directory and have
    a rebuild reload it without restarting Freelens, so that I can iterate
    quickly.
44. As a developer, I want a reload to leave exactly one agent host and one
    handler per IPC channel, so that a rebuild never duplicates work or
    messages.
45. As a developer, I want disabling the extension during a run to stop the run
    without errors in the main-process log, so that the lifecycle is clean.
46. As a maintainer, I want the build, tsconfig, test, lint, Renovate, mise and
    workflow setup identical to the `main` branch, so that there is one stack
    to maintain and the final merge has few conflicts.
47. As a maintainer, I want main, renderer and common code type-checked in
    programs of their own, so that a Node API in the renderer or a DOM API in
    the main process fails the type check.
48. As a maintainer, I want the built main bundle checked to load in plain
    Node, so that a bundle that only Freelens would reject is caught before
    release.
49. As a maintainer, I want `AGENTS.md` and the README to describe the pi agent
    on v2 as it is, so that the next change starts from the truth.
50. As a maintainer, I want a list of manual test cases for Freelens v2, so
    that I can check the port, including the pending manual checks of the pi
    tickets, step by step.
51. As a maintainer, I want one commit per step, so that the history is easy to
    review and bisect.

## Implementation Decisions

How the port is done

- The pi agent branch is ported on its own, through the steps of the
  `port-freelens-extension-to-v2` skill (surface check, manifest and toolchain,
  build, TypeScript layout, source migration, unit tests, tooling and CI,
  documentation), with the `main` branch as the reference. The `main` branch is
  not merged first.
- The build, tsconfig, environment-test, Biome, Knip, Renovate, mise, metafile
  and workflow files are copied from the `main` branch as they are, not from the
  template, because the `main` branch has them at the same pin and fitted to
  this repository. Identical files also merge cleanly at the end.
- Order: pi 1.4.0 on the current toolchain, then the skill's steps 0 to 6, then
  the feature steps (F1, cluster tools in the main process; F2, the Freelens
  HTTP client for pi), then step 7 (documentation), then the manual test cases,
  then one merge of the `main` branch into the pi agent branch after the
  maintainer's checks, keeping the pi agent side wherever the two differ.
- One commit per step, with plain subjects. Commits stay local until the tree
  is green again after step 5, then each step is pushed. Workflows are edited
  directly; the `github-workflow-fix/` staging applies to the CI agent only.
- The plan record (inventory, decisions, step checklist, findings) lives next
  to this spec.

Pin and manifest

- `@freelensapp/extensions` pinned exactly to the nightly the `main` branch
  uses (`2.0.0-0-nightly-2026-10-15`). It has everything the port needs:
  `Main.Util.fetch` typed as the standard `fetch`, `KubeJsonApi.forCluster` in
  both processes, `navigateToPreferences()`, `menuItemFor` and `Main.Shell`.
  Moving to a newer nightly is Renovate's job on the `main` branch.
- `engines.freelens ^2.0.0`, `engines.node >= 24`, `"type": "module"`, version
  `1.0.0-0`, entries and `files` on `dist/`.
- The library and tool versions are the `main` branch's: React 19, mobx 7,
  mobx-react 10, TypeScript 7, Vite 8, Vitest 5, `sass-embedded`, Electron
  types, esbuild, pnpm 12 with strict peer dependencies. The host-provided
  libraries are development dependencies only. electron-vite, the global
  externals, the legacy decorator plugins and `vite-plugin-sass-dts` go.
- pi (`pi-coding-agent` and `pi-ai`) at 1.4.0, bundled.

Build

- Two Vite runs, one per entry. The host-provided modules resolve to
  `globalThis.FreelensExtensionApi`; the renderer run is built for the browser
  and fails on any Node or Electron import; the main run is built for Rolldown's
  `node` platform with the builtins external; standard decorators are lowered;
  the renderer emits exactly one stylesheet; the CSS module declarations are
  written by the build plugin and committed.
- The main bundle is one file, with no code splitting. pi loads its provider
  modules with dynamic `import()`; as chunks, unchanged ones would stay cached
  across a development reload with their state. One file re-evaluates all of pi
  on reload, and `dist/` holds only the main entry, the renderer entry and the
  stylesheet.
- pi's OAuth login modules keep being registered statically at startup, since
  pi's runtime-path loading cannot find them inside the bundle.

TypeScript layout

- A base config with the Freelens compiler options; one program each for main,
  renderer and common; a program for tests; one for tooling files; the
  environment tests, which prove the split with expected errors (Node rejected
  in renderer and common, the DOM rejected in main and common).
- Common code is process-neutral. The React-based logger moves to the renderer,
  with a plain logger for the main process; the chat message object types move
  into common; nothing in common imports renderer or main code.
- The IPC protocol in common keeps pi's shapes. If pi's declarations pull Node
  into the renderer program and the environment tests catch it, the protocol
  declares the shapes it needs itself instead of importing them from pi.

Agent host and IPC (ADR 0001)

- The frames keep talking to the agent host over Freelens IPC: commands with
  `invoke`, envelopes broadcast and filtered by cluster, the snapshot plus
  `seq` for recovery.
- The protocol loses what only the frame-side tools needed: the `tool_request`
  envelope, the `tool_result` command, the pending tool requests of the
  snapshot and the request bookkeeping in the frame. The approval request gains
  the backup YAML of the resource, and the frame no longer loads it.
- pi 1.4.0's `before_agent_start` event is a union on its message type; the
  handler adds the cluster and user-rules sections whatever the type.
- The old-host fallbacks go: the catalog functions are called directly, since
  v2 guarantees them.

Cluster tools in the main process (ADR 0002)

- The agent host runs the tool calls itself. For each call it asks the
  catalog for the chat's cluster; a cluster Freelens does not know, or one that
  is not connected, gets an error result for the model ("cluster not
  connected") and no request is sent. Otherwise the tools use the host's
  JSON client for that cluster (`Main.K8sApi.KubeJsonApi.forCluster`).
- The agent host receives the client per cluster through one injected
  function, so tests pass a stand-in. The tools are written on that client;
  the `Cluster` interface the frame-side tools needed goes.
- Every request goes by path. A kind and an apiVersion resolve to their plural
  and scope from the discovery document of the group version, fetched on every
  call, with no cache; subresources in the document are skipped when looking
  up a kind. The path helpers and their behaviour follow the `main` branch.
- What the tools send, matching what the host's `KubeApi` sends:
  - create and update set the kind, apiVersion, name and namespace on the
    manifest; update is a PUT;
  - a patch is a JSON merge patch; a patch of a subresource (such as `scale`)
    is a strategic merge patch;
  - a delete uses background propagation; a force delete adds a grace period
    of 0; "force finalize" clears the finalizers with a merge patch;
  - deleting a pod with its finalizers clears them with a JSON merge patch
    setting `finalizers` to `null`, then deletes the pod, and the result
    reports what the cluster answered;
  - evicting a pod posts to its `eviction` subresource;
  - a restart is a strategic merge patch of the `restartedAt` annotation of the
    pod template;
  - pod logs come from the `log` subresource as raw text, and the query
    carries only the parameters that are set, never an empty value;
  - the cluster version comes from `/version`, namespaces from the namespace
    list, warning events from the events of the namespace.
- Each request gets pi's abort signal for the tool call, so Stop cancels it.
  There is no fixed timeout.
- The approval gate loads the current object before asking, for every tool
  that changes an existing object, and puts its YAML (apiVersion, kind,
  metadata, spec, status) on the approval request. A failed load leaves the
  card without a backup, as today.
- A failed request is described for the model from the shapes the host's
  client rejects with: an `Error`, a Kubernetes `Status` (a GET answered 403),
  or the host's parsed API error, whose text is its string form.
- The pod logs tail lines preference is read in the main process, from the
  preferences store it already loads.

Proxy and CA settings for pi (F2)

- After a session is created, its stream function is wrapped so that every
  model request carries the host's `fetch` (`Main.Util.fetch`), read when the
  request is sent. This covers the chat and compaction, which use the same
  stream function, and AI Explain's sessions.
- Requests of the Google Generative AI and Google Vertex adapters keep pi's
  default, because those adapters refuse a custom fetch.
- pi's OAuth logins and model-list refreshes do not go through the stream
  function and stay on Node's `fetch`. These gaps are documented in
  `AGENTS.md` and recorded as a finding, with a request to pi for a
  session-level fetch option.
- Nothing replaces the global `fetch` or the global HTTP dispatcher of the main
  process.

Renderer

- Every stylesheet becomes a CSS module imported normally; the inline `<style>`
  injection goes.
- The chat page gets the extension instance from its registration and opens
  the preferences with `navigateToPreferences()`; the Electron `ipcRenderer`
  call on a host channel goes.
- The Explain menu item is registered with `menuItemFor` on the host's event
  class, takes the host's menu item props, and opens the chat page with the
  extension's `navigate()` instead of a hardcoded path.
- The chat page, the menu item and the preferences render inside the error
  boundaries the `main` branch has, applied to each registration field.
- A provider's sign-in URL opens with `window.open`, since the host's
  `openExternal` is gone; Freelens hands it to the system browser.
- React 19 types: no global `React` namespace without an import.
- The cluster frame's cluster id is still read from the frame's host name; the
  root frame takes no part in the chat.
- The stores keep the mobx annotation map on plain fields, as on the `main`
  branch, so the values the host persists stay own properties.

Lifecycle

- `onActivate` starts the provider service and the agent host and registers
  the IPC handlers; `onDeactivate` disposes both, aborting every run and login,
  so a reload or a disable leaves nothing running and the next activation
  registers each handler once.

Documentation and test cases

- `AGENTS.md` keeps the `main` branch's v2 sections on the build, TypeScript,
  tests, lint, CI and the rules that fail silently, and describes the pi agent
  on v2: the agent host, the IPC protocol, the cluster tools in the main
  process, the HTTP client and its gaps. It tells no history.
- The README states the Freelens 2 requirement, the build, the directory
  install and the development loop.
- At the end, a document of manual test cases for Freelens v2, each with steps
  and the expected result, covering: discovery and loading, the development
  reload, mobx-driven UI updates, every user story above, the pending manual
  checks of the fourteen pi tickets, and two clusters at once.

## Testing Decisions

- A good test drives a module through its public interface and asserts what
  an outside observer sees: the envelopes the agent host broadcasts, the
  result the model receives, the requests that go on the wire. It does not
  assert private state or call order inside a module.
- **Agent host** (existing seam, the main one): commands through
  `handleCommand(clusterId, command)`, envelopes through the broadcast
  callback, pi's faux provider as the model. The cluster client and `fetch` are
  injected. New and changed tests: a tool call runs in the main process and its
  result reaches the model with no envelope to the frame; an approval request
  carries the backup YAML; Stop aborts a cluster request in progress; a tool on
  an unknown or disconnected cluster returns the error result without a
  request; the injected `fetch` reaches the provider request (the faux
  provider's response factory receives the request options) and is left out
  for the Google APIs; the cluster and user-rules sections still reach the
  prompt on pi 1.4.0. Prior art: the existing agent host tests.
- **Cluster tools over a stand-in client** (new here): the tools run against a
  stand-in for the host's JSON client of one cluster, which answers GETs from a
  map of paths (the discovery documents included) and records every request.
  Tests assert the method, path, query, body and content type of each
  operation, the discovery lookup for built-in kinds, custom resources and
  irregular plurals, that the pod logs query holds no empty value, that
  deleting a pod with its finalizers sends a merge patch with `finalizers:
  null`, and the error descriptions. The same stand-in serves the agent host
  tests, so the cluster has one fake. The pure helpers (field filter, pod logs,
  resource handlers, version summary, project resource) keep their tests.
  Prior art: the `main` branch's stand-in and its tool tests; the existing
  tool tests, which move from the fake `Cluster` to the stand-in.
- **Chat reducer** (existing seam, pure): the envelopes and snapshots without
  tool requests, and the approval card with its backup arriving with the
  request. Prior art: the existing chat reducer tests.
- **Extension entry**: the main-process extension class against the stub of
  `@freelensapp/extensions`; activating, deactivating and activating again
  leaves one handler per IPC channel and one agent host. Prior art: the
  `main` branch's extension entry test and its stub.
- **Provider service and settings UI**: their existing tests, adjusted only for
  pi 1.4.0.
- **Checks that are not behaviour tests**: the environment tests in the type
  check; and, after each build, a check that the main bundle loads in plain
  Node with a stand-in `FreelensExtensionApi` and exports the extension class,
  with the other built-output checks of the skill (no `global.` host
  references, no bare host-module imports, no Node builtin in the renderer, no
  unlowered decorator, one stylesheet).
- Tests import what they use from `vitest`, are type-checked in their own
  program, and `vitest` imports are banned outside test code, as on the `main`
  branch.
- Validation per step: install, type check, Biome, unit tests, build, Knip
  (from step 6 on), and the built-output checks. Steps 1 to 4 are buildable
  only together; their reports say which checks are expected to fail.

## Out of Scope

- MCP and sub-agents: not part of the pi agent; they may return later as pi
  extensions.
- The local HTTP/SSE bridge of the `main` branch (ADR 0001).
- Bugs #310 and #311, which belong to the LangChain chat and its bridge.
- Freelens 1.x support, and any fallback for older hosts.
- Routing pi's OAuth logins, model-list refreshes and Google requests through
  the Freelens HTTP client.
- Moving to a newer `@freelensapp/extensions` nightly.
- New user-facing features or redesigns beyond what the port requires.
- Running the manual test cases: the maintainer runs them by hand in Freelens
  v2.

## Further Notes

- Risks to check early: that the pi bundle loads as an ESM main entry in plain
  Node and in Freelens (step 2); that pi's declarations do not leak Node into
  the renderer program (step 3); that a development reload with one-file main
  leaves no duplicate state (functional checks).
- A gap or an error found in the Freelens documents or the published package is
  reported to freelensapp/freelens, a gap in the template to
  freelensapp/freelens-example-extension, and a missing pi hook to pi, each
  recorded as a finding in the plan; nothing is worked around with `as any`,
  `globalThis.require` or host internals.
- The final merge of the `main` branch into the pi agent branch also brings in
  whatever Renovate has changed there by then; its conflicts are resolved in
  favour of the pi agent where the code differs, and in favour of the `main`
  branch's versions where only tooling differs.
- The fourteen pi tickets stay "HITL check pending" until the maintainer has
  run the manual test cases on Freelens v2.
