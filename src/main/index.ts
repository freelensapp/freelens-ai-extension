import { join } from "node:path";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Main } from "@freelensapp/extensions";
import { reaction } from "mobx";
import { AGENT_COMMAND_CHANNEL, AGENT_ENVELOPE_CHANNEL, type AgentCommand } from "../common/agent-protocol";
import { AGENT_TOOLS } from "../common/agent-tools";
import { PROVIDER_COMMAND_CHANNEL, PROVIDER_ENVELOPE_CHANNEL, type ProviderCommand } from "../common/provider-protocol";
import { PreferencesStore } from "../common/store";
import { migrateApprovalChoices } from "../common/store/approval-migration";
import { APPROVAL_CHOICE_KEYS, legacyOpenAISettings } from "../common/store/legacy-preferences";
import { AgentHost, type ModelRef } from "./agent/agent-host";
import { migrateAzureCredential, renameAzureModelRef } from "./agent/azure-rename";
import { createCliRunner } from "./agent/cli-runner";
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

// The old per-tool approval choices that differ from the tools' defaults
// become the user profile "Standard (migrated)", the new default profile, and
// the old fields are written back as null. A profile already migrated is not
// added again, should a stale window sync an old field back.
const importApprovalChoices = (preferencesStore: PreferencesStore) => {
  const migrated = migrateApprovalChoices(preferencesStore.legacy);
  if (migrated && !preferencesStore.userProfiles.some((profile) => profile.id === migrated.id)) {
    preferencesStore.userProfiles = [...preferencesStore.userProfiles, migrated];
    preferencesStore.defaultProfileId = migrated.id;
  }
  preferencesStore.clearLegacy(APPROVAL_CHOICE_KEYS);
};

export default class LensExtensionAiMain extends Main.LensExtension {
  private agentHost?: AgentHost;
  private providerService?: ProviderService;
  private stopRecheckingApprovals?: () => void;

  async onActivate() {
    const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

    preferencesStore.loadExtension(this);
    // Before the imports of pi, which clear every old field once they are done.
    importApprovalChoices(preferencesStore);

    try {
      await this.startAgentHost(preferencesStore);
    } catch (error) {
      log.error("Starting the pi agent failed:", error);
    }
  }

  async onDeactivate() {
    this.stopRecheckingApprovals?.();
    this.stopRecheckingApprovals = undefined;
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
      getClusterStatus: (clusterId) => Main.Catalog.getClusterById(clusterId)?.status,
      // kubectl runs here, with the binary and the environment Freelens uses
      // for the cluster's terminal.
      runCli: createCliRunner({
        getKubectlPath: (clusterId, options) => Main.Shell.getKubectlPath(clusterId, options),
        getEnvironment: (clusterId) => Main.Shell.getEnvironment(clusterId),
      }),
      // The store holds the user profiles, the assignments and the default
      // profile, read at every kubectl call and every prompt.
      getPolicyProfileSettings: () => preferencesStore,
      getPodLogsTailLines: () => preferencesStore.podLogsTailLines,
      // The host's client applies the Freelens proxy and CA settings to the model
      // requests; Node's global fetch, pi's default, ignores them. Read when
      // each request is sent.
      fetch: (input, init) => Main.Util.fetch(input, init),
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
    // The three fields are replaced as a whole, so editing a profile's rules or
    // fallback level, an assignment or the default profile checks the pending
    // approvals again at once.
    this.stopRecheckingApprovals = reaction(
      () => [preferencesStore.userProfiles, preferencesStore.profileAssignments, preferencesStore.defaultProfileId],
      () => agentHost.recheckPendingApprovals(),
    );
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
