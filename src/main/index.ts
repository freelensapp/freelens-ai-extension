import { Main } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/store";
import { startOpenAiProxyServer } from "./openai-proxy-server";

export default class LensExtensionAiMain extends Main.LensExtension {
  async onActivate() {
    // @ts-ignore
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

    preferencesStore.loadExtension(this);
    preferencesStore.openAiProxyPort = null;
    preferencesStore.openAiProxyPort = await startOpenAiProxyServer();
  }
}
