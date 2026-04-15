import { Main } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/store";
import { startOpenAiProxyServer } from "./openai-proxy-server";

export default class LensExtensionAiMain extends Main.LensExtension {
  async onActivate() {
    // @ts-ignore
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().loadExtension(this);
    await startOpenAiProxyServer();
  }
}
