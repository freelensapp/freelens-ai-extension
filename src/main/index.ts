import { join } from "node:path";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Main } from "@freelensapp/extensions";
import { AGENT_COMMAND_CHANNEL, AGENT_ENVELOPE_CHANNEL, type AgentCommand } from "../common/agent-protocol";
import { AGENT_TOOLS } from "../common/agent-tools";
import { PROVIDER_COMMAND_CHANNEL, PROVIDER_ENVELOPE_CHANNEL, type ProviderCommand } from "../common/provider-protocol";
import { PreferencesStore } from "../common/store";
import { legacyOpenAISettings } from "../common/store/legacy-preferences";
import { AgentHost, type ModelRef } from "./agent/agent-host";
import { migrateAzureCredential, renameAzureModelRef } from "./agent/azure-rename";
import { importLegacyCredentials, importLegacyCustomProvider } from "./agent/credentials-import";
import { loadDeviceId } from "./agent/device-id";
import { ProviderService } from "./agent/provider-service";
import useLog from "./utils/logger";

const { log } = useLog("freelens-ai");

class AgentMainIpc extends Main.Ipc {}

const parseModelRef = (value: string): ModelRef | undefined => {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
};

export default class LensExtensionAiMain extends Main.LensExtension {
  private agentHost?: AgentHost;
  private providerService?: ProviderService;

  async onActivate() {
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

    preferencesStore.loadExtension(this);

    try {
      await this.startAgentHost(preferencesStore);
    } catch (error) {
      log.error("Starting the pi agent failed:", error);
    }
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
    const authPath = join(piDir, "auth.json");
    const modelsPath = join(piDir, "models.json");
    const modelRuntime = await ModelRuntime.create({ authPath, modelsPath });

    // pi renamed the Azure provider: carry its saved key and the chat's model over.
    await migrateAzureCredential(modelRuntime, authPath).catch((error) =>
      log.error("Moving the Azure key to pi's renamed provider failed:", error),
    );
    const agentModel = renameAzureModelRef(preferencesStore.agentModel);
    if (agentModel !== preferencesStore.agentModel) {
      preferencesStore.agentModel = agentModel;
    }

    await this.importLegacySettings(preferencesStore, modelRuntime, piDir, modelsPath);

    const ipc = AgentMainIpc.createInstance(this) as AgentMainIpc;

    // Provider status, models and logins for the settings page. Global, not per
    // cluster; credentials never leave main.
    const providerService = new ProviderService({
      modelRuntime,
      modelsPath,
      broadcast: (envelope) => ipc.broadcast(PROVIDER_ENVELOPE_CHANNEL, envelope),
      getDeviceId: () => loadDeviceId(join(piDir, "device-id")),
    });
    this.providerService = providerService;
    ipc.handle(PROVIDER_COMMAND_CHANNEL, (_event, command: ProviderCommand) => providerService.handleCommand(command));
    const agentHost = new AgentHost({
      dataDir,
      modelRuntime,
      broadcast: (envelope) => ipc.broadcast(AGENT_ENVELOPE_CHANNEL, envelope),
      tools: AGENT_TOOLS,
      // Every cluster tool runs here, on the host's client of the chat's cluster.
      getClusterStatus: (clusterId) => Main.Catalog.getClusterById(clusterId)?.status,
      getClusterApi: (clusterId) => Main.K8sApi.KubeJsonApi.forCluster(clusterId),
      getPodLogsTailLines: () => preferencesStore.podLogsTailLines,
      // The host's client applies the Freelens proxy and CA settings to the model
      // requests; Node's global fetch, pi's default, ignores them. Read when
      // each request is sent.
      fetch: (input, init) => Main.Util.fetch(input, init),
      // Read before every call, so a changed preference applies to the next one.
      getApprovalOverrides: () => preferencesStore.toolApprovalOverrides,
      // The chat's model picker remembers the last model used here.
      getModelRef: () => parseModelRef(preferencesStore.agentModel),
      getThinkingLevel: () => preferencesStore.thinkingLevel,
      // Read before every prompt, so an edit applies from the next message. AI
      // Explain gets the user's custom agent rules too.
      getUserRules: () => preferencesStore.customAgentRules,
      getClusterName: (clusterId) => Main.Catalog.getClusterById(clusterId)?.name,
      getRetentionDays: () => preferencesStore.chatRetentionDays,
      knownClusterIds: () => Main.Catalog.getAllClusters().map((cluster) => cluster.id),
    });
    this.agentHost = agentHost;
    ipc.handle(AGENT_COMMAND_CHANNEL, (_event, clusterId: string, command: AgentCommand) =>
      agentHost.handleCommand(clusterId, command),
    );
    // The catalog is still loading here, so a cluster missing from it is not
    // taken as removed; New chat prunes the folders of removed clusters.
    agentHost
      .pruneSessions({ dropRemovedClusters: false })
      .catch((error) => log.error("Deleting old chats failed:", error));
  }

  // One-time moves of the old LangChain OpenAI settings into pi, each with its
  // own marker file. Once both have run, the old fields are cleared from the
  // preferences file; a failed import keeps them for the next start.
  private async importLegacySettings(
    preferencesStore: PreferencesStore,
    modelRuntime: ModelRuntime,
    piDir: string,
    modelsPath: string,
  ) {
    const legacy = legacyOpenAISettings(preferencesStore.legacy);
    const seed = (seededModel: string | undefined) => {
      if (seededModel && !preferencesStore.agentModel) {
        preferencesStore.agentModel = seededModel;
      }
    };
    try {
      seed((await importLegacyCredentials(modelRuntime, legacy, join(piDir, "legacy-import-done"))).seededModel);
      seed(
        (await importLegacyCustomProvider(modelRuntime, modelsPath, legacy, join(piDir, "legacy-custom-import-done")))
          .seededModel,
      );
    } catch (error) {
      log.error("Importing the old OpenAI settings into pi failed:", error);
      return;
    }
    preferencesStore.clearLegacy();
  }
}
