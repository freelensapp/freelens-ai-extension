import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageType } from "../../../common/objects/message-type";
import { PreferencesStore } from "../../../common/store";
import { MAIN_PAGE_ID } from "../../navigation/pages";
import { useMenuEntryHook } from "./menu-entry-hook";

import type { Renderer } from "@freelensapp/extensions";

afterEach(() => {
  PreferencesStore.resetInstance();
});

describe("useMenuEntryHook", () => {
  it("hands the event to the chat and opens the chat page of this extension", () => {
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
    const navigate = vi.fn(() => Promise.resolve());
    const extension = { navigate } as unknown as Renderer.LensExtension;

    useMenuEntryHook(preferencesStore, extension).openTab("Back-off restarting failed container");

    expect(preferencesStore.explainEvent.type).toBe(MessageType.EXPLAIN);
    expect(preferencesStore.explainEvent.sent).toBe(true);
    expect(preferencesStore.explainEvent.text).toBe(
      "Could you explain this message?\n\nBack-off restarting failed container",
    );
    expect(navigate).toHaveBeenCalledWith(MAIN_PAGE_ID);
  });
});
