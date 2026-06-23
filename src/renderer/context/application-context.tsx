import { RemoveMessage } from "@langchain/core/messages";
import * as MobxReact from "mobx-react";
import * as React from "react";

const { observer } = MobxReact;
const { createContext, useContext, useEffect, useRef, useState } = React;

import { PreferencesStore } from "../../common/store";
import { AgentStateStore } from "../../common/store/agent-state-store";
import { AgentsStore } from "../../common/store/agents-store";
import { ChatSessionStore } from "../../common/store/chat-session-store";
import useLog from "../../common/utils/logger/logger-service";
import { generateUuid } from "../../common/utils/uuid";
import { FreeLensAgent, useFreeLensAgentSystem } from "../business/agent/freelens-agent-system";
import { MPCAgent, useMcpAgent } from "../business/agent/mcp-agent";
import { getActiveClusterId } from "../business/cluster/active-cluster";
import { getTextMessage } from "../business/objects/message-object-provider";
import { MessageType } from "../business/objects/message-type";
import { AIProviders, DEFAULT_OPENAI_BASE_URL } from "../business/provider/ai-models";
import { computeSessionCost, type ModelPricingMap } from "../business/provider/model-pricing";
import { fetchModelPricing } from "../business/provider/model-pricing-provider";
import { emptyTokenUsage, addTokenUsage as sumTokenUsage, type TokenUsage } from "../business/service/token-usage";
import { IS_CONVERSATION_INTERRUPTED_KEY, IS_LOADING_KEY } from "./chat-session-storage";

import type { MessageObject } from "../business/objects/message-object";

export interface AppContextType {
  apiKey: string;
  selectedModel: string;
  mcpEnabled: boolean;
  mcpConfiguration: string;
  bypassApprovals: boolean;
  explainEvent: MessageObject;
  conversationId: string;
  isLoading: boolean;
  isConversationInterrupted: boolean;
  chatMessages: MessageObject[] | null;
  tokenUsage: TokenUsage;
  // Estimated USD cost of this session for the selected model, or 0 when no
  // price is known. Resets with the token counter when the chat is cleared.
  sessionCost: number;
  freeLensAgent: FreeLensAgent | null;
  mcpAgent: MPCAgent | null;
  setSelectedModel: (selectedModel: string) => void;
  addTokenUsage: (usage: TokenUsage) => void;
  setExplainEvent: (messageObject: MessageObject) => void;
  setBypassApprovals: (bypassApprovals: boolean) => void;
  setLoading: (isLoading: boolean) => void;
  setConversationInterrupted: (isConversationInterrupted: boolean) => void;
  addMessage: (message: MessageObject) => void;
  removeMessage: (messageId: string) => void;
  removeErrorMessages: () => void;
  updateLastMessage: (newText: string) => void;
  updateLastMessageReasoning: (newText: string) => void;
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
  const [chatSessionStore, _setChatSessionStore] = useState<ChatSessionStore>(
    ChatSessionStore.getInstanceOrCreate<ChatSessionStore>(),
  );
  // Resolved once: this cluster frame belongs to exactly one cluster for its
  // whole lifetime. All durable session data (transcript, conversation thread,
  // agent checkpoints) is keyed by this id so each cluster keeps its own chat.
  const [clusterId] = useState<string>(() => getActiveClusterId());
  const [conversationId, _setConversationId] = useState("");
  const [isLoading, _setLoading] = useState(false);
  const [isConversationInterrupted, _setConversationInterrupted] = useState(false);
  const [chatMessages, _setChatMessages] = useState<MessageObject[] | null>(null);
  const [tokenUsage, _setTokenUsage] = useState<TokenUsage>(emptyTokenUsage());
  // Model name => pricing, fetched on start and whenever the model list or
  // endpoint changes. Used to estimate the per-session cost shown by the UI.
  const [modelPricing, _setModelPricing] = useState<ModelPricingMap>({});
  const [freeLensAgent, _setFreeLensAgent] = useState<FreeLensAgent | null>(agentsStore.freeLensAgent);
  const [mcpAgent, _setMcpAgent] = useState<MPCAgent | null>(agentsStore.mcpAgent);

  const prevMcpConfiguration = useRef(preferencesStore.mcpConfiguration);

  const mcpAgentSystem = useMcpAgent(preferencesStore.mcpConfiguration);
  const freeLensAgentSystem = useFreeLensAgentSystem();

  // Init variables
  useEffect(() => {
    _setLoading(window.sessionStorage.getItem(IS_LOADING_KEY) === "true");
    _setConversationInterrupted(window.sessionStorage.getItem(IS_CONVERSATION_INTERRUPTED_KEY) === "true");
    _getConversationId();
    _loadChatMessages();
    _setTokenUsage(chatSessionStore.getTokenUsage(clusterId));
    _initFreeLensAgent();
  }, []);

  // Fetch model pricing on start and whenever the model list, endpoint, or proxy
  // changes. Best-effort: failures leave the map empty and the cost is hidden.
  const modelNames = preferencesStore.models.map((model) => model.name);
  const modelNamesKey = modelNames.join(",");
  useEffect(() => {
    let cancelled = false;
    fetchModelPricing({
      modelNames,
      openAIBaseUrl: preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL,
      proxyPort: preferencesStore.aiProxyPort,
      proxyToken: preferencesStore.aiProxyToken,
    })
      .then((pricing) => {
        if (!cancelled) {
          _setModelPricing(pricing);
        }
      })
      .catch((error) => log.debug("Failed to fetch model pricing: ", error));
    return () => {
      cancelled = true;
    };
  }, [modelNamesKey, preferencesStore.openAIBaseUrl, preferencesStore.aiProxyPort, preferencesStore.aiProxyToken]);

  // Recreate MCP server when MCP configuration change
  useEffect(() => {
    const forceMcpInitialization = preferencesStore.mcpConfiguration !== prevMcpConfiguration.current;
    _initMcpAgent(forceMcpInitialization).then();
    prevMcpConfiguration.current = preferencesStore.mcpConfiguration;
  }, [preferencesStore.mcpConfiguration, preferencesStore.mcpEnabled, preferencesStore.selectedModel]);

  useEffect(() => {
    log.debug("MCP Agent: ", mcpAgent);
  }, [mcpAgent]);

  useEffect(() => {
    log.debug("Freelens Agent: ", freeLensAgent);
  }, [freeLensAgent]);

  const _loadChatMessages = () => {
    // Durable: persisted in the host-managed ChatSessionStore so the transcript
    // survives an app restart (window.localStorage is not durable here).
    _setChatMessages(chatSessionStore.getMessages(clusterId));
  };

  const _getConversationId = () => {
    // Durable: persisted in the host-managed ChatSessionStore so the conversation
    // thread stays stable across an app restart, matching the restored transcript.
    const storedConversationId = chatSessionStore.getConversationId(clusterId);
    if (storedConversationId) {
      _setConversationId(storedConversationId);
      log.debug("Using stored conversation ID: ", storedConversationId);
    } else {
      log.debug("Generating conversation ID");
      const newConverstionId = generateUuid();
      _setConversationId(newConverstionId);
      chatSessionStore.setConversationId(clusterId, newConverstionId);
      log.debug("No stored conversation ID found, generating a new one.");
    }
  };

  const setLoading = (isLoading: boolean) => {
    _setLoading(isLoading);
    // Transient: kept in sessionStorage so a fresh app start never restores a
    // spinner for a run that is no longer active.
    window.sessionStorage.setItem(IS_LOADING_KEY, String(isLoading));
  };

  const setConversationInterrupted = (isConversationInterrupted: boolean) => {
    _setConversationInterrupted(isConversationInterrupted);
    // Transient: see setLoading above.
    window.sessionStorage.setItem(IS_CONVERSATION_INTERRUPTED_KEY, String(isConversationInterrupted));
  };

  const addMessage = (message: MessageObject) => {
    _setChatMessages((prev) => {
      if (!prev) {
        prev = [];
      }
      const updated = [...prev, message];
      chatSessionStore.setMessages(clusterId, updated);
      return updated;
    });
  };

  const removeMessage = (messageId: string) => {
    _setChatMessages((prev) => {
      if (!prev) return prev;
      const updated = prev.filter((message) => message.messageId !== messageId);
      chatSessionStore.setMessages(clusterId, updated);
      return updated;
    });
  };

  // Drop any error messages still in the transcript. Called when the user takes
  // a fresh action (sends a new prompt) so a stale "Retry" button does not
  // linger once the conversation has moved on.
  const removeErrorMessages = () => {
    _setChatMessages((prev) => {
      if (!prev) return prev;
      const updated = prev.filter((message) => !message.error);
      if (updated.length === prev.length) return prev;
      chatSessionStore.setMessages(clusterId, updated);
      return updated;
    });
  };

  const updateLastMessage = (newText: string) => {
    _setChatMessages((prev) => {
      if (!prev || prev.length === 0) return prev;

      const lastIndex = prev.length - 1;
      const messagesCopy = [...prev];
      let lastMessage = messagesCopy[lastIndex];

      // Start a fresh agent message when the last entry is the user's message or
      // a resolved tool-approval interrupt. An interrupt's text holds the YAML
      // request, so appending the streamed answer to it would glue the response
      // into the "Show details" box.
      if (lastMessage.sent || lastMessage.type === MessageType.INTERRUPT) {
        // Agent response does not exist, add a new empty one
        messagesCopy.push(getTextMessage(newText, false));
        chatSessionStore.setMessages(clusterId, messagesCopy);
        return messagesCopy;
      }

      // Agent response exist, update the existing one
      messagesCopy[lastIndex] = {
        ...lastMessage,
        text: lastMessage.text + newText,
      };

      chatSessionStore.setMessages(clusterId, messagesCopy);
      return messagesCopy;
    });
  };

  const updateLastMessageReasoning = (newText: string) => {
    _setChatMessages((prev) => {
      const messagesCopy = prev ? [...prev] : [];
      const lastMessage = messagesCopy[messagesCopy.length - 1];

      // Reasoning streams before the answer text, so the last message is still
      // the user's sent message, a resolved interrupt, or there is none yet:
      // start a fresh agent response to hold the reasoning.
      if (!lastMessage || lastMessage.sent || lastMessage.type === MessageType.INTERRUPT) {
        messagesCopy.push({ ...getTextMessage("", false), reasoning: newText });
      } else {
        messagesCopy[messagesCopy.length - 1] = {
          ...lastMessage,
          reasoning: (lastMessage.reasoning ?? "") + newText,
        };
      }

      chatSessionStore.setMessages(clusterId, messagesCopy);
      return messagesCopy;
    });
  };

  const addTokenUsage = (usage: TokenUsage) => {
    _setTokenUsage((prev) => {
      const updated = sumTokenUsage(prev, usage);
      // Durable: persisted alongside the transcript so the counter survives an
      // app restart and stays in sync with the restored session.
      chatSessionStore.setTokenUsage(clusterId, updated);
      return updated;
    });
  };

  const clearChat = async () => {
    // Zero the per-session token counter alongside the transcript.
    _setTokenUsage(emptyTokenUsage());
    if (freeLensAgent) {
      cleanAgentMessageHistory(freeLensAgent).finally(() => {
        _setChatMessages([]);
        chatSessionStore.clear(clusterId);
      });
    }
    if (mcpAgent) {
      await cleanAgentMessageHistory(mcpAgent).finally(() => {
        _setChatMessages([]);
        chatSessionStore.clear(clusterId);
      });
    }
    // Wipe this cluster's durable LangGraph checkpointer state so a restart right
    // after a clear does not restore the model-side conversation context. Other
    // clusters' memory is left untouched.
    AgentStateStore.getInstanceOrCreate<AgentStateStore>().clearForCluster(clusterId);
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

    if (mcpAgent === null || forceInitialization) {
      log.debug("initializing MCP agent with configuration", preferencesStore.mcpConfiguration);
      setMcpAgent(await mcpAgentSystem.buildAgentSystem(clusterId));
      log.debug("MCP agent initialized!");
    } else {
      log.debug("The MCP Agent was already initialized: ", mcpAgent);
    }
  };

  const _initFreeLensAgent = () => {
    if (freeLensAgent === null) {
      setFreeLensAgent(freeLensAgentSystem.buildAgentSystem(clusterId));
    } else {
      log.debug("Freelens Agent was already initialized: ", freeLensAgent);
    }
  };

  const getActiveAgent = async () => {
    if (preferencesStore.mcpEnabled) {
      if (mcpAgent === null) {
        const _mcpAgent = await mcpAgentSystem.buildAgentSystem(clusterId);
        setMcpAgent(_mcpAgent);
        return _mcpAgent;
      }

      return mcpAgent;
    }

    if (freeLensAgent === null) {
      const _freeLensAgent = freeLensAgentSystem.buildAgentSystem(clusterId);
      setFreeLensAgent(_freeLensAgent);
      log.debug("Freelens Agent initialized: ", freeLensAgent);
      return _freeLensAgent;
    }
    return freeLensAgent;
  };

  const setSelectedModel = (selectedModel: string) => {
    preferencesStore.selectedModel = selectedModel;
  };

  // The API key to use depends on the selected model's provider. Only OpenAI is
  // active for now; other providers are derived here once re-added.
  const getApiKeyForSelectedModel = (): string => {
    const provider = preferencesStore.models.find((model) => model.name === preferencesStore.selectedModel)?.provider;
    switch (provider) {
      case AIProviders.OPEN_AI:
        return preferencesStore.openAIKey;
      default:
        return preferencesStore.openAIKey;
    }
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

  const setBypassApprovals = (bypassApprovals: boolean) => {
    preferencesStore.bypassApprovals = bypassApprovals;
  };

  // Estimate the session cost for the currently selected model. Zero when the
  // model has no known price, so the UI can hide it.
  const selectedPricing = modelPricing[preferencesStore.selectedModel];
  const sessionCost = selectedPricing ? computeSessionCost(tokenUsage, selectedPricing) : 0;

  const changeInterruptStatus = (id: string, status: boolean) => {
    _setChatMessages((prevMessages) => {
      const updated = prevMessages!.map((msg) => (msg.messageId === id ? { ...msg, approved: status } : msg));
      chatSessionStore.setMessages(clusterId, updated);
      return updated;
    });
  };

  return (
    <AppContext.Provider
      value={{
        apiKey: getApiKeyForSelectedModel(),
        selectedModel: preferencesStore.selectedModel,
        mcpEnabled: preferencesStore.mcpEnabled,
        mcpConfiguration: preferencesStore.mcpConfiguration,
        bypassApprovals: preferencesStore.bypassApprovals,
        explainEvent: preferencesStore.explainEvent,
        conversationId,
        isLoading,
        isConversationInterrupted,
        chatMessages,
        tokenUsage,
        sessionCost,
        mcpAgent,
        freeLensAgent,
        setSelectedModel,
        addTokenUsage,
        setExplainEvent,
        setBypassApprovals,
        setLoading,
        setConversationInterrupted,
        addMessage,
        removeMessage,
        removeErrorMessages,
        updateLastMessage,
        updateLastMessageReasoning,
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
