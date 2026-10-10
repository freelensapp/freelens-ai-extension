import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Main } from "@freelensapp/extensions";
import { AGENT_COMMAND_CHANNEL, AGENT_ENVELOPE_CHANNEL, type AgentCommand } from "../common/agent-protocol";
import { AGENT_TOOLS } from "../common/agent-tools";
import { AgentStateStore, ChatSessionStore, PreferencesStore } from "../common/store";
import { AgentHost, type ModelRef } from "./agent/agent-host";
import { importLegacyCredentials } from "./agent/credentials-import";
import { startAiProxyServer } from "./ai-proxy-server";

class AgentMainIpc extends Main.Ipc {}

const parseModelRef = (value: string): ModelRef | undefined => {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
};

export default class LensExtensionAiMain extends Main.LensExtension {
  private agentHost?: AgentHost;

  async onActivate() {
    // @ts-ignore
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

    preferencesStore.loadExtension(this);

    // Owns the on-disk file for the persisted LangGraph checkpointer state. The
    // main process must load it so the renderer receives the persisted value
    // over IPC and the agent can restore its conversation after a restart.
    // @ts-ignore
    AgentStateStore.getInstanceOrCreate<AgentStateStore>().loadExtension(this);

    // Owns the on-disk file for the persisted chat transcript and conversation
    // id. The main process must load it so the renderer receives the persisted
    // value over IPC and the chat HTML can be restored after a restart.
    // @ts-ignore
    ChatSessionStore.getInstanceOrCreate<ChatSessionStore>().loadExtension(this);

    try {
      await this.startAgentHost(preferencesStore);
    } catch (error) {
      // Keep activating: AI Explain still runs on the proxy below.
      console.error("[freelens-ai] Starting the pi agent failed:", error);
    }

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

  async onDeactivate() {
    this.agentHost?.dispose();
    this.agentHost = undefined;
  }

  // The chat's pi agent runs here in main. Frames send commands over IPC and
  // receive the agent's events as broadcast envelopes.
  private async startAgentHost(preferencesStore: PreferencesStore) {
    // pi loads each OAuth login module by a runtime path, which does not exist
    // in our bundle; this registers the bundled modules instead.
    registerBunOAuthFlows();

    const dataDir = await this.getExtensionFileFolder();
    const piDir = join(dataDir, "pi");
    const modelRuntime = await ModelRuntime.create({
      authPath: join(piDir, "auth.json"),
      modelsPath: join(piDir, "models.json"),
    });

    try {
      const { seededModel } = await importLegacyCredentials(
        modelRuntime,
        {
          openAIKey: preferencesStore.openAIKey,
          openAIBaseUrl: preferencesStore.openAIBaseUrl,
          selectedModel: preferencesStore.selectedModel,
        },
        join(piDir, "legacy-import-done"),
      );
      if (seededModel && !preferencesStore.agentModel) {
        preferencesStore.agentModel = seededModel;
      }
    } catch (error) {
      console.error("[freelens-ai] Importing the old OpenAI key into pi failed:", error);
    }

    const ipc = AgentMainIpc.createInstance(this) as AgentMainIpc;
    const agentHost = new AgentHost({
      dataDir,
      modelRuntime,
      broadcast: (envelope) => ipc.broadcast(AGENT_ENVELOPE_CHANNEL, envelope),
      tools: AGENT_TOOLS,
      // Until the chat picker lists pi's models, fall back to the old OpenAI
      // selection, so a key from OPENAI_API_KEY alone still works.
      getModelRef: () =>
        parseModelRef(preferencesStore.agentModel) ??
        (preferencesStore.selectedModel ? { provider: "openai", id: preferencesStore.selectedModel } : undefined),
    });
    this.agentHost = agentHost;
    ipc.handle(AGENT_COMMAND_CHANNEL, (_event, clusterId: string, command: AgentCommand) =>
      agentHost.handleCommand(clusterId, command),
    );
  }
}
