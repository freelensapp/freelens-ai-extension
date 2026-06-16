import { type BroadcastInvoke, broadcastNavigateToExtensionPreferences } from "./extension-preferences";

// `electron` is provided by the Freelens host at runtime and externalized by the
// build, so it is required lazily here rather than imported as a build-time
// dependency.
type ElectronIpcRenderer = { invoke: BroadcastInvoke };

const getIpcRenderer = (): ElectronIpcRenderer =>
  (require("electron") as { ipcRenderer: ElectronIpcRenderer }).ipcRenderer;

// Opens this extension's preferences tab from the chat UI. The chat runs in the
// cluster frame while the preferences page lives in the root frame, so the
// navigation is broadcast through the host's main-process relay instead of
// navigated locally (which would only move the cluster frame's router and fall
// back to its main view).
export const navigateToExtensionPreferences = (): void => {
  const ipcRenderer = getIpcRenderer();
  broadcastNavigateToExtensionPreferences((channel, ...args) => ipcRenderer.invoke(channel, ...args));
};
