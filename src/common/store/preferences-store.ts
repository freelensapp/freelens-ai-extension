import { Common } from "@freelensapp/extensions";
import { RemoveMessage } from "@langchain/core/messages";
import { CompiledStateGraph } from "@langchain/langgraph";
import { makeObservable, observable, toJS } from "mobx";
import { useFreelensAgentSystem } from "../../renderer/business/agent/freelens-agent-system";
import { useMcpAgent } from "../../renderer/business/agent/mcp-agent";
import { MessageObject } from "../../renderer/business/objects/message-object";
import { AIModelsEnum } from "../../renderer/business/provider/ai-models";

export interface PreferencesModel {
  apiKey: string;
  selectedModel: AIModelsEnum;
  mcpEnabled: boolean;
  mcpConfiguration: string;
}

const generateConversationId = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export class PreferencesStore extends Common.Store.ExtensionStore<PreferencesModel> {
  @observable accessor conversationId: string = generateConversationId();
  @observable accessor apiKey: string = "";
  @observable accessor selectedModel: AIModelsEnum = AIModelsEnum.GPT_3_5_TURBO;
  // TODO replace any with the correct types
  @observable accessor freelensAgent: CompiledStateGraph<object, object, any, any, any, any> | null = null;
  // TODO replace any with the correct types
  @observable accessor mcpAgent: CompiledStateGraph<object, object, any, any, any, any> | null = null;
  @observable accessor mcpEnabled: boolean = false;
  @observable accessor mcpConfiguration: string = "";
  @observable accessor isLoading: boolean = false;

  private _conversationInterrupted: boolean = false;
  private _chatMessages: MessageObject[] = [];

  constructor() {
    super({
      configName: "freelens-ai-preferences-store",
      defaults: {
        apiKey: "",
        selectedModel: AIModelsEnum.GPT_3_5_TURBO,
        mcpEnabled: false,
        mcpConfiguration: "",
      },
    });
    this.initMcpAgent(this.mcpConfiguration);
    this.initFreelensAgent();
    makeObservable(this);
  }

  async initMcpAgent(mcpConfiguration: string) {
    this.mcpAgent = await useMcpAgent(mcpConfiguration).buildAgentSystem();
    console.log("MCP Agent initialized: ", this.mcpAgent);
  }

  initFreelensAgent() {
    this.freelensAgent = useFreelensAgentSystem().buildAgentSystem();
    console.log("Freelens Agent initialized: ", this.freelensAgent);
  }

  get chatMessages(): MessageObject[] {
    return this._chatMessages;
  }

  addMessage = (message: MessageObject) => {
    this._chatMessages.push(message);
  };

  updateLastMessage = (newText: string) => {
    if (this._chatMessages.length > 0) {
      const lastMessage = this._chatMessages.pop();
      if (lastMessage) {
        lastMessage.text += newText;
        this._chatMessages.push(lastMessage);
      }
    }
  };

  clearChat = async () => {
    if (this.freelensAgent) {
      await this.cleanAgentMessageHistory(this.freelensAgent);
    }
    if (this.mcpAgent) {
      await this.cleanAgentMessageHistory(this.mcpAgent);
    }
    this._chatMessages = [];
  };

  // TODO replace any with the correct types
  private async cleanAgentMessageHistory(agent: CompiledStateGraph<object, object, any, any, any, any>) {
    console.log("Cleaning agent message history for agent: ", agent);
    if (!agent) {
      console.warn("No agent provided to clean message history.");
      return;
    }

    const config = { configurable: { thread_id: this.conversationId } };

    const messages = (await agent.getState(config)).values.messages;
    console.log("Messages to remove: ", messages);
    if (!messages || messages.length === 0) {
      console.log("No messages to remove.");
      return;
    }

    for (const msg of messages) {
      await agent.updateState(config, { messages: new RemoveMessage({ id: msg.id }) });
    }
  }

  conversationIsInterrupted = () => {
    this._conversationInterrupted = true;
  };

  conversationIsNotInterrupted = () => {
    this._conversationInterrupted = false;
  };

  isConversationInterrupted = () => this._conversationInterrupted;

  getActiveAgent = async () => {
    if (this.mcpEnabled) {
      if (this.mcpAgent == null) {
        this.mcpAgent = await useMcpAgent(this.mcpConfiguration).buildAgentSystem();
      }
      return this.mcpAgent;
    }

    if (this.freelensAgent == null) {
      this.freelensAgent = useFreelensAgentSystem().buildAgentSystem();
    }
    return this.freelensAgent;
  };

  updateMcpConfiguration = async (newMcpConfiguration: string) => {
    this.mcpConfiguration = newMcpConfiguration;
    await this.initMcpAgent(newMcpConfiguration);
    console.log("MCP Agent configuration updated: ", this.mcpConfiguration);
  };

  fromStore = (preferencesModel: PreferencesModel): void => {
    this.apiKey = preferencesModel.apiKey;
    this.selectedModel = preferencesModel.selectedModel;
    this.mcpEnabled = preferencesModel.mcpEnabled;
    this.mcpConfiguration = preferencesModel.mcpConfiguration;
  };

  toJSON = (): PreferencesModel => {
    const value: PreferencesModel = {
      apiKey: this.apiKey,
      selectedModel: this.selectedModel,
      mcpEnabled: this.mcpEnabled,
      mcpConfiguration: this.mcpConfiguration,
    };
    return toJS(value);
  };
}
