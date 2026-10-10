import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Main } from "@freelensapp/extensions";
import { AGENT_COMMAND_CHANNEL, AGENT_ENVELOPE_CHANNEL, type AgentCommand } from "../common/agent-protocol";
import { AGENT_TOOLS } from "../common/agent-tools";
import { PROVIDER_COMMAND_CHANNEL, PROVIDER_ENVELOPE_CHANNEL, type ProviderCommand } from "../common/provider-protocol";
import { AgentStateStore, ChatSessionStore, PreferencesStore } from "../common/store";
import { AgentHost, type ModelRef } from "./agent/agent-host";
import { importLegacyCredentials } from "./agent/credentials-import";
import { loadDeviceId } from "./agent/device-id";
import { ProviderService } from "./agent/provider-service";
import { startAiProxyServer } from "./ai-proxy-server";

class AgentMainIpc extends Main.Ipc {}

const parseModelRef = (value: string): ModelRef | undefined => {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
};

export default class LensExtensionAiMain extends Main.LensExtension {
  private agentHost?: AgentHost;
  private providerService?: ProviderService;
  // The OpenAI API key saved in pi, for AI Explain until it moves to pi. It
  // stays in main: the proxy below adds it to the upstream request.
  private piOpenAIKey?: string;

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
      () => process.env.OPENAI_API_KEY || this.piOpenAIKey || preferencesStore.openAIKey || undefined,
    );
  }

  async onDeactivate() {
    this.agentHost?.dispose();
    this.agentHost = undefined;
    this.providerService?.dispose();
    this.providerService = undefined;
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

    // Provider status, models and logins for the settings page. Global, not per
    // cluster; credentials never leave main.
    const refreshPiOpenAIKey = async () => {
      // A ChatGPT sign-in token does not work against the OpenAI API AI Explain calls.
      const auth = modelRuntime.isUsingOAuth("openai") ? undefined : await modelRuntime.getAuth("openai");
      this.piOpenAIKey = auth?.auth.apiKey;
    };
    const logKeyError = (error: unknown) =>
      console.error("[freelens-ai] Reading the OpenAI key from pi failed:", error);
    refreshPiOpenAIKey().catch(logKeyError);
    const providerService = new ProviderService({
      modelRuntime,
      broadcast: (envelope) => ipc.broadcast(PROVIDER_ENVELOPE_CHANNEL, envelope),
      onCredentialsChanged: () => void refreshPiOpenAIKey().catch(logKeyError),
      getDeviceId: () => loadDeviceId(join(piDir, "device-id")),
    });
    this.providerService = providerService;
    ipc.handle(PROVIDER_COMMAND_CHANNEL, (_event, command: ProviderCommand) => providerService.handleCommand(command));
    const agentHost = new AgentHost({
      dataDir,
      modelRuntime,
      broadcast: (envelope) => ipc.broadcast(AGENT_ENVELOPE_CHANNEL, envelope),
      tools: AGENT_TOOLS,
      // Read before every call, so a changed preference applies to the next one.
      getApprovalOverrides: () => preferencesStore.toolApprovalOverrides,
      // Until the chat picker lists pi's models, fall back to the old OpenAI
      // selection, so a key from OPENAI_API_KEY alone still works.
      getModelRef: () =>
        parseModelRef(preferencesStore.agentModel) ??
        (preferencesStore.selectedModel ? { provider: "openai", id: preferencesStore.selectedModel } : undefined),
      getRetentionDays: () => preferencesStore.chatRetentionDays,
      // Hosts before the main cluster API (Freelens 1.10) keep every cluster's latest chat.
      knownClusterIds: () => Main.Catalog?.getAllClusters?.()?.map((cluster) => cluster.id),
    });
    this.agentHost = agentHost;
    ipc.handle(AGENT_COMMAND_CHANNEL, (_event, clusterId: string, command: AgentCommand) =>
      agentHost.handleCommand(clusterId, command),
    );
    // The catalog is still loading here, so a cluster missing from it is not
    // taken as removed; New chat prunes the folders of removed clusters.
    agentHost
      .pruneSessions({ dropRemovedClusters: false })
      .catch((error) => console.error("[freelens-ai] Deleting old chats failed:", error));
  }
}
