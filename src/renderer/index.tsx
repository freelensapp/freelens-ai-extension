/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Renderer } from "@freelensapp/extensions";
import { ChatSessionStore, PreferencesStore } from "../common/store";
import {
  withMenuItemErrorBoundary,
  withPageErrorBoundary,
  withPreferenceErrorBoundary,
} from "./components/error-boundary";
import { FreeLensAiIcon } from "./components/freelens-ai-icon";
import { MenuEntry } from "./components/menu-entry";
import { MAIN_PAGE_ID } from "./navigation/pages";
import { MainPage } from "./pages/main";
import { PreferencesPage } from "./pages/preferences";

// The chat page, the "Explain" menu item and the preferences render inside an
// error boundary, so that an error they throw stays in their place: the host has
// none around a menu item or an extension's preferences, and its boundary around
// a frame would replace the whole cluster view or preferences page. Each
// registration field is mapped through its wrapper, so an entry added to it is
// wrapped too.
export default class FreeLensAIRenderer extends Renderer.LensExtension {
  async onActivate() {
    // The bridge's port and token, written by main, are read from here too.
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
    // The agents' checkpointer state (AgentStateStore) is main's alone: the
    // agents run there.
    // Durable, host-managed storage for the rendered chat transcript and
    // conversation id, so the chat HTML survives an application restart.
    ChatSessionStore.getInstanceOrCreate<ChatSessionStore>().loadExtension(this);
  }

  clusterPages: Renderer.LensExtension["clusterPages"] = [
    {
      id: MAIN_PAGE_ID,
      components: {
        Page: () => <MainPage extension={this} />,
      },
    },
  ].map((registration) => withPageErrorBoundary(this, registration));

  clusterPageMenus = [
    {
      id: "ai-extension",
      title: "Freelens AI",
      target: { pageId: MAIN_PAGE_ID },
      components: {
        Icon: FreeLensAiIcon,
      },
    },
  ];

  appPreferences: Renderer.LensExtension["appPreferences"] = [
    {
      title: "Freelens AI Settings",
      components: {
        Input: () => <PreferencesPage />,
        Hint: () => <span></span>,
      },
    },
  ].map((registration) => withPreferenceErrorBoundary(this, registration));

  kubeObjectMenuItems: Renderer.LensExtension["kubeObjectMenuItems"] = [
    Renderer.K8sApi.menuItemFor(Renderer.K8sApi.KubeEvent, {
      MenuItem: (props) => <MenuEntry {...props} extension={this} />,
    }),
  ].map((registration) => withMenuItemErrorBoundary(this, registration));
}
