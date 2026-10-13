import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { type CustomModel, DEFAULT_MODELS, DEFAULT_OPENAI_BASE_URL } from "../provider/ai-models";
import { resolveSelectedModel } from "../provider/model-list";

import type { MessageObject } from "../objects/message-object";

const DEFAULT_SELECTED_MODEL = DEFAULT_MODELS[0]?.name ?? "";

export interface PreferencesModel {
  openAIKey: string;
  openAIBaseUrl: string;
  openAIReasoningEffort: string;
  disableThinking: boolean;
  aiProxyPort: number | null;
  aiProxyToken: string | null;
  openAIKeyFromEnvironment: boolean;
  selectedModel: string;
  models: CustomModel[];
  mcpEnabled: boolean;
  mcpConfiguration: string;
  podLogsRequireApproval: boolean;
  podLogsTailLines: number;
  customAgentRules: string;
}

export const DEFAULT_POD_LOGS_TAIL_LINES = 1000;

export class PreferencesStore extends Common.Store.ExtensionStore<PreferencesModel> {
  // Persistent
  openAIKey: string = "";
  openAIBaseUrl: string = DEFAULT_OPENAI_BASE_URL;
  openAIReasoningEffort: string = "";
  disableThinking: boolean = false;
  aiProxyPort: number | null = null;
  // Per-launch shared secret required on every request to the local AI proxy.
  // Generated in the main process on activation and synced to the renderer via
  // this store; blocks other local processes that learn the port from using it.
  aiProxyToken: string | null = null;
  // Whether main found OPENAI_API_KEY in its environment. Set by main on
  // activation, so the renderer can tell whether a key is available without
  // ever receiving the key itself.
  openAIKeyFromEnvironment: boolean = false;
  selectedModel: string = DEFAULT_SELECTED_MODEL;
  models: CustomModel[] = [...DEFAULT_MODELS];
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
        openAIKey: "",
        openAIBaseUrl: DEFAULT_OPENAI_BASE_URL,
        openAIReasoningEffort: "",
        disableThinking: false,
        aiProxyPort: null,
        aiProxyToken: null,
        openAIKeyFromEnvironment: false,
        selectedModel: DEFAULT_SELECTED_MODEL,
        models: [...DEFAULT_MODELS],
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
    // The annotation map on plain fields rather than `@observable accessor`
    // fields: `makeObservable` runs after the field initializers, the fields stay
    // own properties of the instance, and `toJSON()`, which the host persists,
    // reads them as they are. Accessor fields would keep the values behind
    // getters on the prototype, which `toJS()` and spreading do not see.
    makeObservable(this, {
      openAIKey: observable,
      openAIBaseUrl: observable,
      openAIReasoningEffort: observable,
      disableThinking: observable,
      aiProxyPort: observable,
      aiProxyToken: observable,
      openAIKeyFromEnvironment: observable,
      selectedModel: observable,
      models: observable,
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
    this.openAIKey = preferencesModel.openAIKey;
    this.openAIBaseUrl = preferencesModel.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;
    this.openAIReasoningEffort = preferencesModel.openAIReasoningEffort ?? "";
    this.disableThinking = preferencesModel.disableThinking ?? false;
    this.aiProxyPort = preferencesModel.aiProxyPort ?? null;
    this.aiProxyToken = preferencesModel.aiProxyToken ?? null;
    this.openAIKeyFromEnvironment = preferencesModel.openAIKeyFromEnvironment ?? false;
    this.models = preferencesModel.models?.length ? preferencesModel.models : [...DEFAULT_MODELS];
    // Validate the selection against the available models; fall back to the
    // first entry (replaces the old enum validation).
    this.selectedModel = resolveSelectedModel(this.models, preferencesModel.selectedModel);
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
    // `models` is an observable array; the host persists this value by sending
    // it over IPC, which structure-clones it. A live MobX proxy cannot be
    // cloned ("An object could not be cloned"), so convert it to a plain array.
    // `toJS` must be applied to the observable itself: it is a no-op on a plain
    // wrapper object and does not recurse into non-observables.
    return {
      openAIKey: this.openAIKey,
      openAIBaseUrl: this.openAIBaseUrl,
      openAIReasoningEffort: this.openAIReasoningEffort,
      disableThinking: this.disableThinking,
      aiProxyPort: this.aiProxyPort,
      aiProxyToken: this.aiProxyToken,
      openAIKeyFromEnvironment: this.openAIKeyFromEnvironment,
      selectedModel: this.selectedModel,
      models: toJS(this.models),
      mcpEnabled: this.mcpEnabled,
      mcpConfiguration: this.mcpConfiguration,
      podLogsRequireApproval: this.podLogsRequireApproval,
      podLogsTailLines: this.podLogsTailLines,
      customAgentRules: this.customAgentRules,
    };
  }
}
