/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Renderer } from "@freelensapp/extensions";
import { ChatSessionStore, PreferencesStore } from "../common/store";
import { FreeLensAiIcon } from "./components/freelens-ai-icon";
import { MenuEntry } from "./components/menu-entry";
import { setNavigateToExtensionPreferences } from "./navigation/navigate-to-extension-preferences";
import { MainPage } from "./pages/main";
import { PreferencesPage } from "./pages/preferences";

type KubeObject = Renderer.K8sApi.KubeObject;
type KubeObjectMenuProps<TKubeObject extends KubeObject> = Renderer.Component.KubeObjectMenuProps<TKubeObject>;

export default class FreeLensAIRenderer extends Renderer.LensExtension {
  async onActivate() {
    // The chat's "Configure agent" button opens this extension's own
    // preferences tab.
    setNavigateToExtensionPreferences(() => this.navigateToPreferences());
    // The bridge's port and token, written by main, are read from here too.
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
    // The agents' checkpointer state (AgentStateStore) is main's alone: the
    // agents run there.
    // Durable, host-managed storage for the rendered chat transcript and
    // conversation id, so the chat HTML survives an application restart.
    ChatSessionStore.getInstanceOrCreate<ChatSessionStore>().loadExtension(this);
  }

  clusterPages = [
    {
      id: "ai-extension-main-page",
      components: {
        Page: () => <MainPage />,
      },
    },
  ];

  clusterPageMenus = [
    {
      id: "ai-extension",
      title: "Freelens AI",
      target: { pageId: "ai-extension-main-page" },
      components: {
        Icon: FreeLensAiIcon,
      },
    },
  ];

  appPreferences = [
    {
      title: "Freelens AI Settings",
      components: {
        Input: () => <PreferencesPage />,
        Hint: () => <span></span>,
      },
    },
  ];

  kubeObjectMenuItems = [
    {
      kind: "Event",
      apiVersions: ["v1"],
      components: {
        MenuItem: (props: KubeObjectMenuProps<Renderer.K8sApi.KubeEvent>) => <MenuEntry {...props} />,
      },
    },
  ];
}
