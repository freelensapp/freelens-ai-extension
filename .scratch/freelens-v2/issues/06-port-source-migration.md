# 06: Port, step 4: source migration

**What to build:** the source on the v2 API, so that the type check and the
build pass. The user sees the same extension:

- Every stylesheet is a CSS module imported normally; the `?inline` imports
  and the `<style>` injection go. The styles apply in both themes.
- The "Connect a provider" link opens this extension's preferences tab with
  `navigateToPreferences()`; the Electron `ipcRenderer` call on a host channel
  goes.
- The cluster menu entry opens the chat page with the extension's
  `navigate()` and the page id, not a hardcoded path.
- The Explain menu item is registered with `menuItemFor` on the host's event
  class and takes the host's menu item props.
- The chat page, the Explain menu item and the preferences render inside the
  error boundaries the `main` branch has, applied to each registration field.
- A provider's sign-in page opens with `window.open`, since `openExternal` is
  gone.
- React 19 types: no global `React` namespace without an import.
- The catalog functions are called directly; the old-host fallbacks and the
  `@ts-ignore` on the store singleton go.
- The stores keep the mobx annotation map on plain fields, as on the `main`
  branch, so the values the host saves stay own properties.
- The frame-side cluster tools stop casting into the protected request client
  of a `KubeApi` and use the frame's `KubeJsonApi.forCluster` instead. This is
  temporary: ticket 10 deletes the frame-side tools.

No `as any`, no `globalThis.require`, no host internals.

**Blocked by:** 05 (port, step 3).

**Status:** ready-for-agent

- [ ] Type check passes for every program, environment tests included.
- [ ] The build passes, and so do the checks of the built output.
- [ ] No `?inline` import, no Electron import in the renderer, no hardcoded
      extension route, no `openExternal`, no cast into a protected host member.
- [ ] Each registration field of the chat page, the menu item and the
      preferences is wrapped in an error boundary.
- [ ] One commit.
