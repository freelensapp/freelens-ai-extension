import { Main } from "@freelensapp/extensions";
import { PreferencesStore } from "../common/store";
import { startAiProxyServer } from "./ai-proxy-server";

export default class LensExtensionAiMain extends Main.LensExtension {
  async onActivate() {
    // @ts-ignore
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

    preferencesStore.loadExtension(this);
    preferencesStore.aiProxyPort = null;
    // The proxy injects the API key into the upstream request from here in the
    // main process, so the key never has to be sent from the renderer.
    preferencesStore.aiProxyPort = await startAiProxyServer(
      () => process.env.OPENAI_API_KEY || preferencesStore.openAIKey || undefined,
    );
  }
}
