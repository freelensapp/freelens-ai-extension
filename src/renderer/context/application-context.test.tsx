// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatSessionStore, PreferencesStore } from "../../common/store";
import { ApplicationContextProvider, useApplicationStatusStore } from "./application-context";

import type { Renderer } from "@freelensapp/extensions";

afterEach(() => {
  cleanup();
  PreferencesStore.resetInstance();
  ChatSessionStore.resetInstance();
});

const ConfigureAgent = () => {
  const { navigateToPreferences } = useApplicationStatusStore();
  return (
    <button type="button" onClick={navigateToPreferences}>
      Configure agent
    </button>
  );
};

describe("ApplicationContextProvider", () => {
  it("opens the preferences of the extension it is given", () => {
    const navigateToPreferences = vi.fn();
    const extension = { navigateToPreferences } as unknown as Renderer.LensExtension;

    render(
      <ApplicationContextProvider extension={extension}>
        <ConfigureAgent />
      </ApplicationContextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Configure agent" }));

    expect(navigateToPreferences).toHaveBeenCalledTimes(1);
  });
});
