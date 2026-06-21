/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Renderer } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/store";
import { ensureRunnableContextStorage } from "./business/agent/runnable-context";
import { FreeLensAiIcon } from "./components/freelens-ai-icon";
import { MenuEntry } from "./components/menu-entry";
import { setExtensionPreferencesPath } from "./navigation/extension-preferences";
import { MainPage } from "./pages/main";
import { PreferencesPage } from "./pages/preferences";

type KubeObject = Renderer.K8sApi.KubeObject;
type KubeObjectMenuProps<TKubeObject extends KubeObject> = Renderer.Component.KubeObjectMenuProps<TKubeObject>;

export default class FreeLensAIRenderer extends Renderer.LensExtension {
  async onActivate() {
    // Wire LangChain's AsyncLocalStorage run-context singleton before any agent
    // graph runs. LangGraph's `interrupt()` (the write-tool approval gate) reads
    // the run config from this singleton, which the renderer's browser bundle
    // never initializes; without it the approval prompt cannot reach the UI.
    ensureRunnableContextStorage();
    // Resolve the route to this extension's own preferences tab so the chat
    // "Configure agent" button can link straight to it.
    setExtensionPreferencesPath(this.sanitizedExtensionId);
    // @ts-ignore
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
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
