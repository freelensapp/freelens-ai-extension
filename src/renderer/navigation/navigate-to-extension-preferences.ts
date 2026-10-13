// Opens this extension's preferences tab from the chat UI. The chat runs in the
// cluster frame while the preferences live in the root frame;
// `LensRendererExtension#navigateToPreferences()` reaches the root frame from
// there, which `Renderer.Navigation.navigate` cannot. The extension instance
// registers it on activation.

let navigate: () => void = () => {};

export const setNavigateToExtensionPreferences = (navigateToPreferences: () => void): void => {
  navigate = navigateToPreferences;
};

export const navigateToExtensionPreferences = (): void => navigate();
