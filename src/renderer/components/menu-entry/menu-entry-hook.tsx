import { getExplainMessage } from "../../business/objects/message-object-provider";
import { MAIN_PAGE_ID } from "../../navigation/pages";

import type { Renderer } from "@freelensapp/extensions";

import type { PreferencesStore } from "../../../common/store";

export const useMenuEntryHook = (preferencesStore: PreferencesStore, extension: Renderer.LensExtension) => {
  const openTab = (message: string) => {
    const prompt = "Could you explain this message?\n\n";
    preferencesStore.explainEvent = getExplainMessage(`${prompt}${message}`);
    // The menu item is shown in the cluster frame, where the chat page is too.
    void extension.navigate(MAIN_PAGE_ID);
  };

  return { openTab };
};
