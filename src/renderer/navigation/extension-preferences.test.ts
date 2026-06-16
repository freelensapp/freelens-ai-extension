import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROADCAST_MAIN_CHANNEL,
  broadcastNavigateToExtensionPreferences,
  getExtensionPreferencesPath,
  NAVIGATE_IN_APP_CHANNEL,
  setExtensionPreferencesPath,
} from "./extension-preferences";

afterEach(() => {
  // Reset module state back to the generic route between tests.
  setExtensionPreferencesPath("");
});

describe("extension preferences path", () => {
  it("falls back to the generic preferences route before activation", () => {
    expect(getExtensionPreferencesPath()).toBe("/preferences");
  });

  it("targets the extension's own tab once the sanitized id is set", () => {
    setExtensionPreferencesPath("freelensapp--ai-extension");
    expect(getExtensionPreferencesPath()).toBe("/preferences/freelensapp--ai-extension");
  });

  it("falls back to the generic route when the sanitized id is empty", () => {
    setExtensionPreferencesPath("freelensapp--ai-extension");
    setExtensionPreferencesPath("");
    expect(getExtensionPreferencesPath()).toBe("/preferences");
  });
});

describe("broadcastNavigateToExtensionPreferences", () => {
  it("broadcasts the in-app navigation event for the extension preferences path", () => {
    setExtensionPreferencesPath("freelensapp--ai-extension");
    const invoke = vi.fn();

    broadcastNavigateToExtensionPreferences(invoke);

    expect(invoke).toHaveBeenCalledWith(
      BROADCAST_MAIN_CHANNEL,
      NAVIGATE_IN_APP_CHANNEL,
      "/preferences/freelensapp--ai-extension",
    );
  });
});
