// Resolves the route to this extension's own preferences tab. The Freelens host
// registers each extension's primary preferences page at
// `/preferences/:preferenceTabId?` where the tab id is the extension's
// `sanitizedExtensionId`. That id is only known at activation, so it is captured
// there via `setExtensionPreferencesPath`. Falls back to the generic preferences
// route until activation runs.
//
// The preferences page is rendered in the root frame, but the chat UI runs in
// the cluster frame. `Renderer.Navigation.navigate` only moves the current
// frame's router, so from the cluster frame it cannot reach the root-only
// preferences route and the cluster router falls back to its main view. The host
// reaches the root frame from a cluster frame by broadcasting an in-app
// navigation event through the main process; `broadcastNavigateToExtensionPreferences`
// reproduces that here.
//
// `ipc:broadcast-main` relays a renderer message through the main process to
// every frame and `renderer:navigate` is the in-app navigation event the root
// frame listens for.
export const BROADCAST_MAIN_CHANNEL = "ipc:broadcast-main";
export const NAVIGATE_IN_APP_CHANNEL = "renderer:navigate";

export type BroadcastInvoke = (channel: string, ...args: unknown[]) => unknown;

let preferencesPath = "/preferences";

export const setExtensionPreferencesPath = (sanitizedExtensionId: string): void => {
  preferencesPath = sanitizedExtensionId ? `/preferences/${sanitizedExtensionId}` : "/preferences";
};

export const getExtensionPreferencesPath = (): string => preferencesPath;

// Broadcasts the host navigation event that makes the root frame open this
// extension's preferences tab. Pure (the broadcaster is injected) so it can be
// unit-tested without electron.
export const broadcastNavigateToExtensionPreferences = (invoke: BroadcastInvoke): void => {
  invoke(BROADCAST_MAIN_CHANNEL, NAVIGATE_IN_APP_CHANNEL, getExtensionPreferencesPath());
};
