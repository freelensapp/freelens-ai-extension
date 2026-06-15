import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { type CustomModel, DEFAULT_MODELS, DEFAULT_OPENAI_BASE_URL } from "../../renderer/business/provider/ai-models";

import type { MessageObject } from "../../renderer/business/objects/message-object";

const DEFAULT_SELECTED_MODEL = DEFAULT_MODELS[0]?.name ?? "";

export interface PreferencesModel {
  openAIKey: string;
  openAIBaseUrl: string;
  openAIReasoningEffort: string;
  // googleAIKey: string;
  aiProxyPort: number | null;
  selectedModel: string;
  models: CustomModel[];
  mcpEnabled: boolean;
  mcpConfiguration: string;
  // ollamaHost: string;
  // ollamaPort: string;
}

export class PreferencesStore extends Common.Store.ExtensionStore<PreferencesModel> {
  // Persistent
  @observable accessor openAIKey: string = "";
  @observable accessor openAIBaseUrl: string = DEFAULT_OPENAI_BASE_URL;
  @observable accessor openAIReasoningEffort: string = "";
  // @observable accessor googleAIKey: string = "";
  @observable accessor aiProxyPort: number | null = null;
  @observable accessor selectedModel: string = DEFAULT_SELECTED_MODEL;
  @observable accessor models: CustomModel[] = [...DEFAULT_MODELS];
  @observable accessor mcpEnabled: boolean = false;
  @observable accessor mcpConfiguration: string = "";
  // @observable accessor ollamaHost: string = "";
  // @observable accessor ollamaPort: string = "";

  // Not persistent
  @observable accessor explainEvent: MessageObject = {} as MessageObject;
  // Not persistent: when enabled, the agent auto-approves tool-use requests
  @observable accessor bypassApprovals: boolean = false;

  constructor() {
    super({
      configName: "freelens-ai-preferences-store",
      defaults: {
        openAIKey: "",
        openAIBaseUrl: DEFAULT_OPENAI_BASE_URL,
        openAIReasoningEffort: "",
        // googleAIKey: "",
        aiProxyPort: null,
        selectedModel: DEFAULT_SELECTED_MODEL,
        models: [...DEFAULT_MODELS],
        mcpEnabled: false,
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
        // ollamaHost: "http://127.0.0.1",
        // ollamaPort: "9898",
      },
    });
    makeObservable(this);
  }

  updateMcpConfiguration = async (newMcpConfiguration: string) => {
    this.mcpConfiguration = newMcpConfiguration;
  };

  fromStore = (preferencesModel: PreferencesModel): void => {
    this.openAIKey = preferencesModel.openAIKey;
    this.openAIBaseUrl = preferencesModel.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;
    this.openAIReasoningEffort = preferencesModel.openAIReasoningEffort ?? "";
    // this.googleAIKey = preferencesModel.googleAIKey;
    this.aiProxyPort = preferencesModel.aiProxyPort ?? null;
    this.models = preferencesModel.models?.length ? preferencesModel.models : [...DEFAULT_MODELS];
    // Validate the selection against the available models; fall back to the
    // first entry (replaces the old enum validation).
    this.selectedModel = this.models.some((model) => model.name === preferencesModel.selectedModel)
      ? preferencesModel.selectedModel
      : (this.models[0]?.name ?? DEFAULT_SELECTED_MODEL);
    this.mcpEnabled = preferencesModel.mcpEnabled;
    this.mcpConfiguration = preferencesModel.mcpConfiguration;
    // this.ollamaHost = preferencesModel.ollamaHost;
    // this.ollamaPort = preferencesModel.ollamaPort;
  };

  toJSON = (): PreferencesModel => {
    const value: PreferencesModel = {
      openAIKey: this.openAIKey,
      openAIBaseUrl: this.openAIBaseUrl,
      openAIReasoningEffort: this.openAIReasoningEffort,
      // googleAIKey: this.googleAIKey,
      aiProxyPort: this.aiProxyPort,
      selectedModel: this.selectedModel,
      models: this.models,
      mcpEnabled: this.mcpEnabled,
      mcpConfiguration: this.mcpConfiguration,
      // ollamaHost: this.ollamaHost,
      // ollamaPort: this.ollamaPort,
    };
    return toJS(value);
  };
}
