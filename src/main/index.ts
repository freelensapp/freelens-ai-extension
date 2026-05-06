import { Main } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/store";
import { startAiProxyServer } from "./ai-proxy-server";

export default class LensExtensionAiMain extends Main.LensExtension {
  async onActivate() {
    // @ts-ignore
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

    preferencesStore.loadExtension(this);
    preferencesStore.aiProxyPort = null;
    preferencesStore.aiProxyPort = await startAiProxyServer();
  }
}
