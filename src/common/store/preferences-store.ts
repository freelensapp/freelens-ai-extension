import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { MessageObject } from "../../renderer/business/objects/message-object";
import { AIModelsEnum } from "../../renderer/business/provider/ai-models";

export interface PreferencesModel {
  openAIKey: string;
  googleAIKey: string;
  selectedModel: AIModelsEnum;
  mcpEnabled: boolean;
  mcpConfiguration: string;
  ollamaHost: string;
  ollamaPort: string;
}

export class PreferencesStore extends Common.Store.ExtensionStore<PreferencesModel> {
  // Persistent
  @observable accessor openAIKey: string = "";
  @observable accessor googleAIKey: string = "";
  @observable accessor selectedModel: AIModelsEnum = AIModelsEnum.GPT_3_5_TURBO;
  @observable accessor mcpEnabled: boolean = false;
  @observable accessor mcpConfiguration: string = "";
  @observable accessor ollamaHost: string = "";
  @observable accessor ollamaPort: string = "";

  // Not persistent
  @observable accessor explainEvent: MessageObject = {} as MessageObject;

  constructor() {
    super({
      configName: "freelens-ai-preferences-store",
      defaults: {
        openAIKey: "",
        googleAIKey: "",
        selectedModel: AIModelsEnum.GPT_3_5_TURBO,
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
        ollamaHost: "http://127.0.0.1",
        ollamaPort: "9898",
      },
    });
    makeObservable(this);
  }

  updateMcpConfiguration = async (newMcpConfiguration: string) => {
    this.mcpConfiguration = newMcpConfiguration;
  };

  fromStore = (preferencesModel: PreferencesModel): void => {
    this.openAIKey = preferencesModel.openAIKey;
    this.googleAIKey = preferencesModel.googleAIKey;
    this.selectedModel = preferencesModel.selectedModel;
    this.mcpEnabled = preferencesModel.mcpEnabled;
    this.mcpConfiguration = preferencesModel.mcpConfiguration;
    this.ollamaHost = preferencesModel.ollamaHost;
    this.ollamaPort = preferencesModel.ollamaPort;
  };

  toJSON = (): PreferencesModel => {
    const value: PreferencesModel = {
      openAIKey: this.openAIKey,
      googleAIKey: this.googleAIKey,
      selectedModel: this.selectedModel,
      mcpEnabled: this.mcpEnabled,
      mcpConfiguration: this.mcpConfiguration,
      ollamaHost: this.ollamaHost,
      ollamaPort: this.ollamaPort,
    };
    return toJS(value);
  };
}
