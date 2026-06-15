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
  @observable openAIKey: string = "";
  @observable openAIBaseUrl: string = DEFAULT_OPENAI_BASE_URL;
  @observable openAIReasoningEffort: string = "";
  // @observable googleAIKey: string = "";
  @observable aiProxyPort: number | null = null;
  @observable selectedModel: string = DEFAULT_SELECTED_MODEL;
  @observable models: CustomModel[] = [...DEFAULT_MODELS];
  @observable mcpEnabled: boolean = false;
  @observable mcpConfiguration: string = "";
  // @observable ollamaHost: string = "";
  // @observable ollamaPort: string = "";

  // Not persistent
  @observable explainEvent: MessageObject = {} as MessageObject;
  // Not persistent: when enabled, the agent auto-approves tool-use requests
  @observable bypassApprovals: boolean = false;

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

  async updateMcpConfiguration(newMcpConfiguration: string) {
    this.mcpConfiguration = newMcpConfiguration;
  }

  fromStore(preferencesModel: PreferencesModel): void {
    this.openAIKey = preferencesModel.openAIKey;
    this.openAIBaseUrl = preferencesModel.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;
    this.openAIReasoningEffort = preferencesModel.openAIReasoningEffort ?? "";
    // this.googleAIKey = preferencesModel.googleAIKey;
    this.aiProxyPort = preferencesModel.aiProxyPort ?? null;
    this.models = preferencesModel.models?.length ? preferencesModel.models : [...DEFAULT_MODELS];
    // Validate the selection against the available models; fall back to the
    // first entry (replaces the old enum validation).
    this.selectedModel = resolveSelectedModel(this.models, preferencesModel.selectedModel);
    this.mcpEnabled = preferencesModel.mcpEnabled;
    this.mcpConfiguration = preferencesModel.mcpConfiguration;
    // this.ollamaHost = preferencesModel.ollamaHost;
    // this.ollamaPort = preferencesModel.ollamaPort;
  }

  toJSON(): PreferencesModel {
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
  }
}
