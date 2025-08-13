import { RemoveMessage } from "@langchain/core/messages";
import { observer } from "mobx-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { PreferencesStore } from "../../common/store";
import { AgentsStore } from "../../common/store/agents-store";
import useLog from "../../common/utils/logger/logger-service";
import { generateUuid } from "../../common/utils/uuid";
import { FreeLensAgent, useFreeLensAgentSystem } from "../business/agent/freelens-agent-system";
import { MPCAgent, useMcpAgent } from "../business/agent/mcp-agent";
import { MessageObject } from "../business/objects/message-object";
import { getTextMessage } from "../business/objects/message-object-provider";
import { AIModelsEnum } from "../business/provider/ai-models";

export interface AppContextType {
  apiKey: string;
  selectedModel: AIModelsEnum;
  mcpEnabled: boolean;
  mcpConfiguration: string;
  explainEvent: MessageObject;
  ollamaHost: string;
  ollamaPort: string;
  conversationId: string;
  isLoading: boolean;
  isConversationInterrupted: boolean;
  chatMessages: MessageObject[] | null;
  freeLensAgent: FreeLensAgent | null;
  mcpAgent: MPCAgent | null;
  setSelectedModel: (selectedModel: AIModelsEnum) => void;
  setExplainEvent: (messageObject: MessageObject) => void;
  setLoading: (isLoading: boolean) => void;
  setConversationInterrupted: (isConversationInterrupted: boolean) => void;
  addMessage: (message: MessageObject) => void;
  updateLastMessage: (newText: string) => void;
  clearChat: () => void;
  getActiveAgent: () => Promise<any>;
  changeInterruptStatus: (id: string, status: boolean) => void;
  getAvailableTools: () => Promise<any[]>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const ApplicationContextProvider = observer(({ children }: { children: React.ReactNode }) => {
  const { log } = useLog("useChatService");
  const [preferencesStore, _setPreferencesStore] = useState<PreferencesStore>(
    PreferencesStore.getInstanceOrCreate<PreferencesStore>(),
  );
  const [agentsStore, _setAgentsStore] = useState<AgentsStore>(AgentsStore.getInstanceOrCreate<AgentsStore>());
  const [conversationId, _setConversationId] = useState("");
  const [isLoading, _setLoading] = useState(false);
  const [isConversationInterrupted, _setConversationInterrupted] = useState(false);
  const [chatMessages, _setChatMessages] = useState<MessageObject[] | null>(null);
  const [freeLensAgent, _setFreeLensAgent] = useState<FreeLensAgent | null>(agentsStore.freeLensAgent);
  const [mcpAgent, _setMcpAgent] = useState<MPCAgent | null>(agentsStore.mcpAgent);

  const prevMcpConfiguration = useRef(preferencesStore.mcpConfiguration);

  const mcpAgentSystem = useMcpAgent(preferencesStore.mcpConfiguration);
  const freeLensAgentSystem = useFreeLensAgentSystem();

  // Init variables
  useEffect(() => {
    _setLoading(window.sessionStorage.getItem("isLoading") === "true");
    _setConversationInterrupted(window.sessionStorage.getItem("isConversationInterrupted") === "true");
    _getConversationId();
    _loadChatMessages();
    _initFreeLensAgent();
  }, []);

  // Recreate MCP server when MCP configuration change
  useEffect(() => {
    const forceMcpInitialization = preferencesStore.mcpConfiguration !== prevMcpConfiguration.current;
    _initMcpAgent(forceMcpInitialization).then();
    prevMcpConfiguration.current = preferencesStore.mcpConfiguration;
  }, [preferencesStore.mcpConfiguration, preferencesStore.mcpEnabled, preferencesStore.selectedModel]);

  function _isMcpServerCompatible() {
    return AIModelsEnum.GEMINI_2_FLASH !== preferencesStore.selectedModel;
  }

  useEffect(() => {
    log.debug("MCP Agent: ", mcpAgent);
  }, [mcpAgent]);

  useEffect(() => {
    log.debug("Freelens Agent: ", freeLensAgent);
  }, [freeLensAgent]);

  const _loadChatMessages = () => {
    const stringMessages = window.sessionStorage.getItem("chatMessages");
    stringMessages ? _setChatMessages(JSON.parse(stringMessages)) : _setChatMessages([]);
  };

  const _getConversationId = () => {
    const storedConversationId = window.sessionStorage.getItem("conversationId");
    if (storedConversationId) {
      _setConversationId(storedConversationId);
      log.debug("Using stored conversation ID: ", storedConversationId);
    } else {
      log.debug("Generating conversation ID");
      const newConverstionId = generateUuid();
      _setConversationId(newConverstionId);
      window.sessionStorage.setItem("conversationId", newConverstionId);
      log.debug("No stored conversation ID found, generating a new one.");
    }
  };

  const setLoading = (isLoading: boolean) => {
    _setLoading(isLoading);
    window.sessionStorage.setItem("isLoading", String(isLoading));
  };

  const setConversationInterrupted = (isConversationInterrupted: boolean) => {
    _setConversationInterrupted(isConversationInterrupted);
    window.sessionStorage.setItem("isConversationInterrupted", String(isConversationInterrupted));
  };

  const addMessage = (message: MessageObject) => {
    _setChatMessages((prev) => {
      if (!prev) {
        prev = [];
      }
      const updated = [...prev, message];
      window.sessionStorage.setItem("chatMessages", JSON.stringify(updated));
      return updated;
    });
  };

  const updateLastMessage = (newText: string) => {
    _setChatMessages((prev) => {
      if (!prev || prev.length === 0) return prev;

      const lastIndex = prev.length - 1;
      const messagesCopy = [...prev];
      let lastMessage = messagesCopy[lastIndex];

      if (lastMessage.sent) {
        // Agent response does not exist, add a new empty one
        messagesCopy.push(getTextMessage(newText, false));
        window.sessionStorage.setItem("chatMessages", JSON.stringify(messagesCopy));
        return messagesCopy;
      }

      // Agent response exist, update the existing one
      messagesCopy[lastIndex] = {
        ...lastMessage,
        text: lastMessage.text + newText,
      };

      window.sessionStorage.setItem("chatMessages", JSON.stringify(messagesCopy));
      return messagesCopy;
    });
  };

  const clearChat = async () => {
    if (freeLensAgent) {
      cleanAgentMessageHistory(freeLensAgent).finally(() => {
        _setChatMessages([]);
        window.sessionStorage.setItem("chatMessages", JSON.stringify([]));
      });
    }
    if (mcpAgent) {
      await cleanAgentMessageHistory(mcpAgent).finally(() => {
        _setChatMessages([]);
        window.sessionStorage.setItem("chatMessages", JSON.stringify([]));
      });
    }
  };

  const cleanAgentMessageHistory = async (agent: FreeLensAgent | MPCAgent) => {
    log.debug("Cleaning agent message history for agent: ", agent);
    if (!agent) {
      console.warn("No agent provided to clean message history.");
      return;
    }

    const config = { configurable: { thread_id: conversationId } };

    const messages = (await agent.getState(config)).values.messages;
    log.debug("Messages to remove: ", messages);
    if (!messages || messages.length === 0) {
      log.debug("No messages to remove.");
      return;
    }

    for (const msg of messages) {
      await agent.updateState(config, { messages: new RemoveMessage({ id: msg.id }) });
    }
  };

  const setFreeLensAgent = (freeLensAgent: FreeLensAgent) => {
    agentsStore.freeLensAgent = freeLensAgent;
    _setFreeLensAgent(freeLensAgent);
  };

  const setMcpAgent = (mcpAgent: MPCAgent) => {
    agentsStore.mcpAgent = mcpAgent;
    _setMcpAgent(mcpAgent);
  };

  const _initMcpAgent = async (forceInitialization: boolean = false) => {
    if (!preferencesStore.mcpEnabled) {
      if (mcpAgent) {
        log.debug("The MCP Agent is disabled but it is already initialized");
      } else {
        log.debug("The MCP Agent is disabled and will not be initialized");
        return;
      }
    }

    if (!_isMcpServerCompatible()) {
      if (mcpAgent) {
        log.debug("The MCP Agent is not compatible with Gemini but it is already initialized");
      } else {
        log.debug("The MCP Agent is not compatible with Gemini and will not be initialized");
        return;
      }
    }

    if (mcpAgent === null || forceInitialization) {
      log.debug("initializing MCP agent with configuration", preferencesStore.mcpConfiguration);
      setMcpAgent(await mcpAgentSystem.buildAgentSystem());
      log.debug("MCP agent initialized!");
    } else {
      log.debug("The MCP Agent was already initialized: ", mcpAgent);
    }
  };

  const _initFreeLensAgent = () => {
    if (freeLensAgent === null) {
      setFreeLensAgent(freeLensAgentSystem.buildAgentSystem());
    } else {
      log.debug("Freelens Agent was already initialized: ", freeLensAgent);
    }
  };

  const getActiveAgent = async () => {
    if (preferencesStore.mcpEnabled) {
      if (!_isMcpServerCompatible()) {
        log.debug("The MCP Agent is not compatible with Gemini and will not be used");
      } else {
        if (mcpAgent === null) {
          const _mcpAgent = await mcpAgentSystem.buildAgentSystem();
          setMcpAgent(_mcpAgent);
          return _mcpAgent;
        }
        return mcpAgent;
      }
    }

    if (freeLensAgent === null) {
      const _freeLensAgent = freeLensAgentSystem.buildAgentSystem();
      setFreeLensAgent(_freeLensAgent);
      log.debug("Freelens Agent initialized: ", freeLensAgent);
      return _freeLensAgent;
    }
    return freeLensAgent;
  };

  const setSelectedModel = (selectedModel: AIModelsEnum) => {
    preferencesStore.selectedModel = selectedModel;
  };

  const getAvailableTools = async () => {
    if (preferencesStore.mcpEnabled) {
      return await mcpAgentSystem.loadMcpTools();
    }
    return freeLensAgentSystem.availableTools;
  };

  const setExplainEvent = (messageObject: MessageObject) => {
    preferencesStore.explainEvent = messageObject;
  };

  const changeInterruptStatus = (id: string, status: boolean) => {
    _setChatMessages((prevMessages) =>
      prevMessages!.map((msg) => (msg.messageId === id ? { ...msg, approved: status } : msg)),
    );
  };

  return (
    <AppContext.Provider
      value={{
        apiKey: preferencesStore.openAIKey,
        selectedModel: preferencesStore.selectedModel,
        mcpEnabled: preferencesStore.mcpEnabled,
        mcpConfiguration: preferencesStore.mcpConfiguration,
        explainEvent: preferencesStore.explainEvent,
        ollamaHost: preferencesStore.ollamaHost,
        ollamaPort: preferencesStore.ollamaPort,
        conversationId,
        isLoading,
        isConversationInterrupted,
        chatMessages,
        mcpAgent,
        freeLensAgent,
        setSelectedModel,
        setExplainEvent,
        setLoading,
        setConversationInterrupted,
        addMessage,
        updateLastMessage,
        clearChat,
        getActiveAgent,
        changeInterruptStatus,
        getAvailableTools,
      }}
    >
      {children}
    </AppContext.Provider>
  );
});

export const useApplicationStatusStore = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApplicationStatusStore must be used within ApplicationContextProvider");
  return context;
};
