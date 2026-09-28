import * as MobxReact from "mobx-react";
import * as React from "react";

const { observer } = MobxReact;
const { createContext, useContext, useEffect, useRef, useState } = React;

import { PreferencesStore } from "../../common/store";
import { ChatSessionStore } from "../../common/store/chat-session-store";
import useLog from "../../common/utils/logger/logger-service";
import { generateUuid } from "../../common/utils/uuid";
import { resetConversation } from "../business/agent/freelens-agent";
import {
  clearFreelensAgentConversation,
  getAvailableTools,
  getFreelensAgent,
} from "../business/agent/freelens-agent-provider";
import { getActiveClusterId } from "../business/cluster/active-cluster";
import { getTextMessage } from "../business/objects/message-object-provider";
import { MessageType } from "../business/objects/message-type";
import { AIProviders, DEFAULT_OPENAI_BASE_URL } from "../business/provider/ai-models";
import { computeSessionCost, type ModelPricingMap } from "../business/provider/model-pricing";
import { fetchModelPricing } from "../business/provider/model-pricing-provider";
import { approximateTokenCount } from "../business/provider/token-estimate";
import { resolveMaxInputTokens } from "../business/service/session-compaction";
import { useSessionCompactionService } from "../business/service/session-compaction-service";
import { emptyTokenUsage, addTokenUsage as sumTokenUsage, type TokenUsage } from "../business/service/token-usage";
import { IS_CONVERSATION_INTERRUPTED_KEY, IS_LOADING_KEY } from "./chat-session-storage";

import type { Agent } from "@strands-agents/sdk";

import type { MessageObject } from "../business/objects/message-object";

// Transient status shown while the session is compacted: dimmed "Compacting
// conversation..." during, then normal "Compacted conversation." after. Null
// hides the indicator.
export type CompactionStatus = "compacting" | "compacted" | null;

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
  // Approximate size of the persisted conversation that the next prompt re-sends
  // (parent-thread messages, ~4 chars/token). Drives the capacity indicator and
  // the compaction decision; updated live as the run progresses.
  lastInputTokens: number;
  // Largest single LLM call's input tokens in the last run - a transient
  // intra-turn spike shown only in the indicator tooltip, never used to size the
  // gauge or trigger compaction.
  lastPeakInputTokens: number;
  // Transient compaction status shown in the input bar, or null when idle.
  compactionStatus: CompactionStatus;
  setSelectedModel: (selectedModel: string) => void;
  addTokenUsage: (usage: TokenUsage) => void;
  setLastInputTokens: (lastInputTokens: number) => void;
  setLastPeakInputTokens: (lastPeakInputTokens: number) => void;
  // Max input tokens for the selected model from the fetched pricing data,
  // falling back to a conservative default for unknown models.
  getMaxInputTokens: () => number;
  // Summarize and reset the model-side history before the next prompt. Returns
  // the summary to seed into that prompt, or null when nothing was compacted.
  compactSession: () => Promise<string | null>;
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
  getActiveAgent: () => Promise<Agent>;
  changeInterruptStatus: (id: string, status: boolean) => void;
  getAvailableTools: () => Promise<{ name: string; description: string }[]>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const ApplicationContextProvider = observer(({ children }: { children: React.ReactNode }) => {
  const { log } = useLog("useChatService");
  const [preferencesStore, _setPreferencesStore] = useState<PreferencesStore>(
    PreferencesStore.getInstanceOrCreate<PreferencesStore>(),
  );
  const [chatSessionStore, _setChatSessionStore] = useState<ChatSessionStore>(
    ChatSessionStore.getInstanceOrCreate<ChatSessionStore>(),
  );
  // Resolved once: this cluster frame belongs to exactly one cluster for its
  // whole lifetime. All durable session data (transcript, conversation thread,
  // agent session) is keyed by this id so each cluster keeps its own chat.
  const [clusterId] = useState<string>(() => getActiveClusterId());
  const [conversationId, _setConversationId] = useState("");
  const [isLoading, _setLoading] = useState(false);
  const [isConversationInterrupted, _setConversationInterrupted] = useState(false);
  const [chatMessages, _setChatMessages] = useState<MessageObject[] | null>(null);
  const [tokenUsage, _setTokenUsage] = useState<TokenUsage>(emptyTokenUsage());
  // Persisted-context size that drives compaction (durable), the last run's peak
  // single-call input shown only in the tooltip (transient, not persisted), and
  // the compaction status shown while the session is being compacted.
  const [lastInputTokens, _setLastInputTokens] = useState<number>(0);
  const [lastPeakInputTokens, _setLastPeakInputTokens] = useState<number>(0);
  const [compactionStatus, _setCompactionStatus] = useState<CompactionStatus>(null);
  // Model name => pricing, fetched on start and whenever the model list or
  // endpoint changes. Used to estimate the per-session cost shown by the UI.
  const [modelPricing, _setModelPricing] = useState<ModelPricingMap>({});
  // Holds the pending timer that hides the "Compacted conversation." status after
  // a short delay, so a new compaction can cancel and restart it.
  const compactionStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionCompactionService = useSessionCompactionService();

  // Init variables
  useEffect(() => {
    _setLoading(window.sessionStorage.getItem(IS_LOADING_KEY) === "true");
    _setConversationInterrupted(window.sessionStorage.getItem(IS_CONVERSATION_INTERRUPTED_KEY) === "true");
    _getConversationId();
    _loadChatMessages();
    _setTokenUsage(chatSessionStore.getTokenUsage(clusterId));
    _setLastInputTokens(chatSessionStore.getLastInputTokens(clusterId));
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

  const setLastInputTokens = (value: number) => {
    _setLastInputTokens(value);
    // Durable: persisted so the compaction decision survives an app restart.
    chatSessionStore.setLastInputTokens(clusterId, value);
  };

  // Transient: the peak is a within-turn diagnostic for the tooltip only, so it
  // is kept in memory and not persisted alongside the durable session state.
  const setLastPeakInputTokens = (value: number) => {
    _setLastPeakInputTokens(value);
  };

  // Max input tokens for the selected model, from the pricing data already
  // fetched for the cost estimate. Falls back to a conservative default for
  // models with no known limit.
  const getMaxInputTokens = (): number => resolveMaxInputTokens(modelPricing[preferencesStore.selectedModel]);

  // Summarize the agent history into a short summary, wipe that history, and
  // reset the context-size estimate so the next prompt starts small. The summary
  // is returned so the caller can seed it into the next prompt. On any failure
  // the history is still wiped (best effort) so the next prompt cannot exceed the
  // limit; only the summary context is lost.
  const compactSession = async (): Promise<string | null> => {
    _showCompacting();
    let agent: Agent | null = null;

    try {
      agent = await getActiveAgent();
      const summary = await sessionCompactionService.summarize(agent.messages);
      await resetConversation(agent);
      // The new context is just the summary, so reset the estimate to its size
      // and clear the last run's peak (a stale within-turn diagnostic).
      setLastInputTokens(approximateTokenCount(summary));
      setLastPeakInputTokens(0);
      _showCompacted();
      return summary.length > 0 ? summary : null;
    } catch (error) {
      log.error("Failed to compact session: ", error);
      // Best effort: drop the model-side history anyway so the next prompt is
      // small, even though we could not summarize it.
      try {
        if (agent) {
          await resetConversation(agent);
        }
      } catch (cleanError) {
        log.error("Failed to clean history during compaction fallback: ", cleanError);
      }
      setLastInputTokens(0);
      setLastPeakInputTokens(0);
      _showCompacted();
      return null;
    }
  };

  const _showCompacting = () => {
    if (compactionStatusTimer.current) {
      clearTimeout(compactionStatusTimer.current);
      compactionStatusTimer.current = null;
    }
    _setCompactionStatus("compacting");
  };

  // Show the "Compacted conversation." status, then hide it after a short delay
  // so the transient notification does not linger on the input bar.
  const _showCompacted = () => {
    _setCompactionStatus("compacted");
    if (compactionStatusTimer.current) {
      clearTimeout(compactionStatusTimer.current);
    }
    compactionStatusTimer.current = setTimeout(() => {
      _setCompactionStatus(null);
      compactionStatusTimer.current = null;
    }, 5000);
  };

  const clearChat = async () => {
    // Zero the per-session token counter and context-size estimate alongside the
    // transcript, and drop any lingering compaction status.
    _setTokenUsage(emptyTokenUsage());
    setLastInputTokens(0);
    setLastPeakInputTokens(0);
    _setCompactionStatus(null);
    // Wipe the agent conversation and this cluster's persisted session, so a
    // restart right after a clear does not restore the model-side context.
    // Other clusters' memory is left untouched.
    try {
      await clearFreelensAgentConversation(clusterId);
    } catch (error) {
      log.error("Failed to clear the agent conversation: ", error);
    } finally {
      _setChatMessages([]);
      chatSessionStore.clear(clusterId);
    }
  };

  const getActiveAgent = () => getFreelensAgent(clusterId, conversationId);

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
        lastInputTokens,
        lastPeakInputTokens,
        compactionStatus,
        setSelectedModel,
        addTokenUsage,
        setLastInputTokens,
        setLastPeakInputTokens,
        getMaxInputTokens,
        compactSession,
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
