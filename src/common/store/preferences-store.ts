import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { type CustomModel, DEFAULT_MODELS, DEFAULT_OPENAI_BASE_URL } from "../../renderer/business/provider/ai-models";
import { resolveSelectedModel } from "../../renderer/business/provider/model-list";

import type { MessageObject } from "../../renderer/business/objects/message-object";

const DEFAULT_SELECTED_MODEL = DEFAULT_MODELS[0]?.name ?? "";

export interface PreferencesModel {
  openAIKey: string;
  openAIBaseUrl: string;
  openAIReasoningEffort: string;
  disableThinking: boolean;
  aiProxyPort: number | null;
  selectedModel: string;
  models: CustomModel[];
  mcpEnabled: boolean;
  mcpConfiguration: string;
  podLogsRequireApproval: boolean;
  podLogsTailLines: number;
}

export const DEFAULT_POD_LOGS_TAIL_LINES = 1000;

export class PreferencesStore extends Common.Store.ExtensionStore<PreferencesModel> {
  // Persistent
  openAIKey: string = "";
  openAIBaseUrl: string = DEFAULT_OPENAI_BASE_URL;
  openAIReasoningEffort: string = "";
  disableThinking: boolean = false;
  aiProxyPort: number | null = null;
  selectedModel: string = DEFAULT_SELECTED_MODEL;
  models: CustomModel[] = [...DEFAULT_MODELS];
  mcpEnabled: boolean = false;
  mcpConfiguration: string = "";
  // When enabled, reading pod logs goes through the human-in-the-loop approval
  // gate (logs can contain secrets/PII). Enabled by default.
  podLogsRequireApproval: boolean = true;
  // Default number of tail lines fetched when reading pod logs.
  podLogsTailLines: number = DEFAULT_POD_LOGS_TAIL_LINES;

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
        selectedModel: DEFAULT_SELECTED_MODEL,
        models: [...DEFAULT_MODELS],
        mcpEnabled: false,
        podLogsRequireApproval: true,
        podLogsTailLines: DEFAULT_POD_LOGS_TAIL_LINES,
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
      openAIKey: observable,
      openAIBaseUrl: observable,
      openAIReasoningEffort: observable,
      disableThinking: observable,
      aiProxyPort: observable,
      selectedModel: observable,
      models: observable,
      mcpEnabled: observable,
      mcpConfiguration: observable,
      podLogsRequireApproval: observable,
      podLogsTailLines: observable,
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
      selectedModel: this.selectedModel,
      models: toJS(this.models),
      mcpEnabled: this.mcpEnabled,
      mcpConfiguration: this.mcpConfiguration,
      podLogsRequireApproval: this.podLogsRequireApproval,
      podLogsTailLines: this.podLogsTailLines,
    };
  }
}
