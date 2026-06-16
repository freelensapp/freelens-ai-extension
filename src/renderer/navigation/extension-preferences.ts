// Resolves the route to this extension's own preferences tab. The Freelens host
// registers each extension's primary preferences page at
// `/preferences/:preferenceTabId?` where the tab id is the extension's
// `sanitizedExtensionId`. That id is only known at activation, so it is captured
// there via `setExtensionPreferencesPath`. Falls back to the generic preferences
// route until activation runs.

let preferencesPath = "/preferences";

export const setExtensionPreferencesPath = (sanitizedExtensionId: string): void => {
  preferencesPath = sanitizedExtensionId ? `/preferences/${sanitizedExtensionId}` : "/preferences";
};

export const getExtensionPreferencesPath = (): string => preferencesPath;
