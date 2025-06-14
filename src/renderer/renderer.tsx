/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// transpiled .tsx code must have `React` symbol in the scope
// @ts-ignore
import React from "react";

import { Renderer } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/store";
import { FreelensAiIcon } from "./components/freelens-ai-icon";
import MenuEntry from "./components/menu-entry/menu-entry";
import { MainPage } from "./pages/main";
import { PreferencesPage } from "./pages/preferences";

type KubeObject = Renderer.K8sApi.KubeObject;
type KubeObjectMenuProps<TKubeObject extends KubeObject> = Renderer.Component.KubeObjectMenuProps<TKubeObject>;

export default class FreeLensAIRenderer extends Renderer.LensExtension {
  async onActivate() {
    PreferencesStore.createInstance().loadExtension(this);
  }

  clusterPages = [
    {
      id: "extension-ai-main-page",
      components: {
        Page: () => <MainPage />,
      },
    },
  ];

  clusterPageMenus = [
    {
      id: "extension-ai",
      title: "Freelens AI",
      target: { pageId: "extension-ai-main-page" },
      components: {
        Icon: FreelensAiIcon,
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
        // TODO Freelens 1.4.0 should have Event type exposed
        MenuItem: (props: KubeObjectMenuProps<any>) => <MenuEntry {...props} />,
      },
    },
  ];
}
