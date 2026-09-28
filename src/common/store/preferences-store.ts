import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { createDefaultProviders, type ProviderConfig } from "../../renderer/business/provider/ai-models";
import {
  type LegacyProviderPreferences,
  migrateLegacyProviders,
  resolveSelection,
  sanitizeProviders,
} from "../../renderer/business/provider/provider-list";

import type { MessageObject } from "../../renderer/business/objects/message-object";

const DEFAULT_SELECTION = resolveSelection(createDefaultProviders(), {});

// The old per-protocol fields (openAIKey, models, ...) are still read once to
// build the provider list, then no longer written.
export interface PreferencesModel extends LegacyProviderPreferences {
  // Null until the provider list exists: preferences saved before it are then
  // migrated from the old fields (see fromStore).
  providers: ProviderConfig[] | null;
  openAIReasoningEffort: string;
  disableThinking: boolean;
  aiProxyPort: number | null;
  aiProxyToken: string | null;
  selectedProviderId: string;
  selectedModel: string;
  mcpEnabled: boolean;
  mcpConfiguration: string;
  podLogsRequireApproval: boolean;
  podLogsTailLines: number;
  customAgentRules: string;
}

export const DEFAULT_POD_LOGS_TAIL_LINES = 1000;

export class PreferencesStore extends Common.Store.ExtensionStore<PreferencesModel> {
  // Persistent
  providers: ProviderConfig[] = createDefaultProviders();
  openAIReasoningEffort: string = "";
  disableThinking: boolean = false;
  aiProxyPort: number | null = null;
  // Per-launch shared secret required on every request to the local AI proxy.
  // Generated in the main process on activation and synced to the renderer via
  // this store; blocks other local processes that learn the port from using it.
  aiProxyToken: string | null = null;
  // The chat's model: `selectedModel` of the provider `selectedProviderId`.
  selectedProviderId: string = DEFAULT_SELECTION.providerId;
  selectedModel: string = DEFAULT_SELECTION.model;
  mcpEnabled: boolean = false;
  mcpConfiguration: string = "";
  // When enabled, reading pod logs goes through the human-in-the-loop approval
  // gate (logs can contain secrets/PII). Enabled by default.
  podLogsRequireApproval: boolean = true;
  // Default number of tail lines fetched when reading pod logs.
  podLogsTailLines: number = DEFAULT_POD_LOGS_TAIL_LINES;
  // User-provided extra agent rules appended to every agent's system message.
  customAgentRules: string = "";

  // Not persistent
  explainEvent: MessageObject = {} as MessageObject;
  // Not persistent: when enabled, the agent auto-approves tool-use requests
  bypassApprovals: boolean = false;

  constructor() {
    super({
      configName: "freelens-ai-preferences-store",
      defaults: {
        providers: null,
        openAIReasoningEffort: "",
        disableThinking: false,
        aiProxyPort: null,
        aiProxyToken: null,
        // Empty so a selection saved before the provider list (model name only)
        // is matched by name instead of against the default provider.
        selectedProviderId: "",
        selectedModel: DEFAULT_SELECTION.model,
        mcpEnabled: false,
        podLogsRequireApproval: true,
        podLogsTailLines: DEFAULT_POD_LOGS_TAIL_LINES,
        customAgentRules: "",
        mcpConfiguration: JSON.stringify(
          {
            mcpServers: {
              kubernetes: {
                command: "npx",
                args: ["mcp-server-kubernetes"],
              },
            },
          },
          null,
          2,
        ),
      },
    });
    // Use the explicit annotation form instead of `@observable` decorators.
    // The build's legacy decorator transform emits native class-field
    // initializers, which the decorators cannot convert into observables; the
    // explicit form reads the initialized field values directly and works
    // regardless of how the build emits class fields.
    makeObservable(this, {
      providers: observable,
      openAIReasoningEffort: observable,
      disableThinking: observable,
      aiProxyPort: observable,
      aiProxyToken: observable,
      selectedProviderId: observable,
      selectedModel: observable,
      mcpEnabled: observable,
      mcpConfiguration: observable,
      podLogsRequireApproval: observable,
      podLogsTailLines: observable,
      customAgentRules: observable,
      explainEvent: observable,
      bypassApprovals: observable,
    });
  }

  async updateMcpConfiguration(newMcpConfiguration: string) {
    this.mcpConfiguration = newMcpConfiguration;
  }

  fromStore(preferencesModel: PreferencesModel): void {
    this.providers = Array.isArray(preferencesModel.providers)
      ? sanitizeProviders(preferencesModel.providers)
      : migrateLegacyProviders(preferencesModel);
    this.openAIReasoningEffort = preferencesModel.openAIReasoningEffort ?? "";
    this.disableThinking = preferencesModel.disableThinking ?? false;
    this.aiProxyPort = preferencesModel.aiProxyPort ?? null;
    this.aiProxyToken = preferencesModel.aiProxyToken ?? null;
    // Validate the selection against the available models; fall back to the
    // first one. A selection saved before the provider list has no provider id
    // and matches the first provider offering that model.
    const selection = resolveSelection(this.providers, {
      providerId: preferencesModel.selectedProviderId,
      model: preferencesModel.selectedModel,
    });
    this.selectedProviderId = selection.providerId;
    this.selectedModel = selection.model;
    this.mcpEnabled = preferencesModel.mcpEnabled;
    this.mcpConfiguration = preferencesModel.mcpConfiguration;
    this.podLogsRequireApproval = preferencesModel.podLogsRequireApproval ?? true;
    this.podLogsTailLines =
      typeof preferencesModel.podLogsTailLines === "number" && preferencesModel.podLogsTailLines > 0
        ? preferencesModel.podLogsTailLines
        : DEFAULT_POD_LOGS_TAIL_LINES;
    this.customAgentRules = preferencesModel.customAgentRules ?? "";
  }

  toJSON(): PreferencesModel {
    // `providers` is an observable array; the host persists this value by sending
    // it over IPC, which structure-clones it. A live MobX proxy cannot be
    // cloned ("An object could not be cloned"), so convert it to a plain array.
    // `toJS` must be applied to the observable itself: it is a no-op on a plain
    // wrapper object and does not recurse into non-observables.
    return {
      providers: toJS(this.providers),
      openAIReasoningEffort: this.openAIReasoningEffort,
      disableThinking: this.disableThinking,
      aiProxyPort: this.aiProxyPort,
      aiProxyToken: this.aiProxyToken,
      selectedProviderId: this.selectedProviderId,
      selectedModel: this.selectedModel,
      mcpEnabled: this.mcpEnabled,
      mcpConfiguration: this.mcpConfiguration,
      podLogsRequireApproval: this.podLogsRequireApproval,
      podLogsTailLines: this.podLogsTailLines,
      customAgentRules: this.customAgentRules,
    };
  }
}
