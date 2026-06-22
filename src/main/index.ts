import { randomBytes } from "node:crypto";
import { Main } from "@freelensapp/extensions";
import { AgentStateStore, PreferencesStore } from "../common/store";
import { startAiProxyServer } from "./ai-proxy-server";

export default class LensExtensionAiMain extends Main.LensExtension {
  async onActivate() {
    // @ts-ignore
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

    preferencesStore.loadExtension(this);

    // Owns the on-disk file for the persisted LangGraph checkpointer state. The
    // main process must load it so the renderer receives the persisted value
    // over IPC and the agent can restore its conversation after a restart.
    // @ts-ignore
    AgentStateStore.getInstanceOrCreate<AgentStateStore>().loadExtension(this);

    // Generate a fresh shared secret for this launch and require it on every
    // proxy request, so a local process that learns the port cannot reuse the
    // user's API key.
    const aiProxyToken = randomBytes(32).toString("hex");
    preferencesStore.aiProxyToken = aiProxyToken;

    preferencesStore.aiProxyPort = null;
    // The proxy injects the API key into the upstream request from here in the
    // main process, so the key never has to be sent from the renderer. It also
    // requires the per-launch shared secret on every request.
    preferencesStore.aiProxyPort = await startAiProxyServer(
      aiProxyToken,
      () => process.env.OPENAI_API_KEY || preferencesStore.openAIKey || undefined,
    );
  }
}
