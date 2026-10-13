import { randomBytes } from "node:crypto";
import { Main } from "@freelensapp/extensions";
import { DEFAULT_OPENAI_BASE_URL } from "../common/provider/ai-models";
import { AgentStateStore, ChatSessionStore, PreferencesStore } from "../common/store";
import { AgentRuntime } from "./agents/agent-runtime";
import { createBridgeRoutes } from "./bridge/routes";
import { type BridgeServer, startBridgeServer } from "./bridge/server";
import { fetchModelPricing } from "./provider/model-pricing-provider";
import { resolveOpenAIKey } from "./provider/model-provider";

export default class LensExtensionAiMain extends Main.LensExtension {
  private bridge: BridgeServer | null = null;

  async onActivate() {
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

    preferencesStore.loadExtension(this);

    // Owns the on-disk file for the persisted LangGraph checkpointer state,
    // which the agents read and write here in main, so the agent can restore
    // its conversation after a restart.
    AgentStateStore.getInstanceOrCreate<AgentStateStore>().loadExtension(this);

    // Owns the on-disk file for the persisted chat transcript and conversation
    // id. The main process must load it so the renderer receives the persisted
    // value over IPC and the chat HTML can be restored after a restart.
    ChatSessionStore.getInstanceOrCreate<ChatSessionStore>().loadExtension(this);

    // The renderer has no environment of its own; it learns from the store
    // whether OPENAI_API_KEY is set, never the key.
    preferencesStore.openAIKeyFromEnvironment = Boolean(process.env.OPENAI_API_KEY?.trim());

    // A fresh shared secret for this launch, required on every bridge request,
    // so a local process that learns the port cannot drive the agents with the
    // user's API key.
    const token = randomBytes(32).toString("hex");
    preferencesStore.aiProxyPort = null;
    preferencesStore.aiProxyToken = token;

    const runtime = new AgentRuntime();
    this.bridge = await startBridgeServer({
      token,
      routes: createBridgeRoutes({
        runtime,
        fetchModelPricing: () =>
          fetchModelPricing({
            modelNames: preferencesStore.models.map((model) => model.name),
            openAIBaseUrl: preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL,
            apiKey: resolveOpenAIKey(preferencesStore),
            fetch: Main.Util.fetch,
          }),
      }),
    });
    // The renderer reads the port and the token for every request, so after a
    // reload it reaches the new bridge without reopening the page.
    preferencesStore.aiProxyPort = this.bridge.port;
  }

  async onDeactivate() {
    // Cancels every open run, so a reload leaves exactly one bridge bound.
    const bridge = this.bridge;
    this.bridge = null;
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().aiProxyPort = null;
    await bridge?.close();
  }
}
