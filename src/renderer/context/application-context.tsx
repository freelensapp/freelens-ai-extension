import * as MobxReact from "mobx-react";
import * as React from "react";

const { observer } = MobxReact;
const { createContext, useContext, useEffect, useState } = React;

import { PreferencesStore } from "../../common/store";
import {
  editAgentTranscript,
  getAgentChat,
  onAgentChat,
  resetAgentChat,
  sendAgentCommand,
  turnOffAutoApprove as turnOffAutoApproveInMain,
} from "../business/agent-client/agent-client";
import { getFrameClusterId } from "../business/cluster/frame-cluster-id";
import useLog from "../utils/logger/logger-service";
import { IS_LOADING_KEY } from "./chat-session-storage";

import type { Renderer } from "@freelensapp/extensions";

import type { SessionStats } from "../../common/agent-protocol";
import type { MessageObject } from "../../common/objects/message-object";
import type { ChatViewState } from "../business/agent-client/chat-reducer";

export interface AppContextType {
  // The cluster of this frame; the chat and its pi agent session are bound to
  // it. Undefined outside a cluster frame, where the chat sends nothing.
  clusterId: string | undefined;
  // "Approve all in this chat" is on in main: gated calls run without a card.
  autoApproveAll: boolean;
  explainEvent: MessageObject;
  isLoading: boolean;
  // True while this cluster's pi agent run is going: the Stop button shows.
  isAgentRunning: boolean;
  chatMessages: MessageObject[] | null;
  // pi's totals for this cluster's chat, computed in main: tokens, cost and how
  // full the context is. Undefined until main has sent any.
  sessionStats: SessionStats | undefined;
  // The chat model as "provider/id", remembered as the last one used.
  setSelectedModel: (modelRef: string) => void;
  setExplainEvent: (messageObject: MessageObject) => void;
  turnOffAutoApprove: () => Promise<void>;
  setLoading: (isLoading: boolean) => void;
  stopAgent: () => Promise<void>;
  addMessage: (message: MessageObject) => void;
  removeMessage: (messageId: string) => void;
  removeErrorMessages: () => void;
  // New chat: the cluster's current chat stays on disk until retention deletes it.
  clearChat: () => Promise<void>;
  // Deletes every saved chat of this cluster and starts an empty one.
  deleteAllChats: () => Promise<void>;
  // Opens this extension's preferences tab, in the root frame.
  navigateToPreferences: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export interface ApplicationContextProviderProps {
  extension: Renderer.LensExtension;
  children: React.ReactNode;
}

export const ApplicationContextProvider = observer(({ extension, children }: ApplicationContextProviderProps) => {
  const { log } = useLog("useChatService");
  const [preferencesStore] = useState<PreferencesStore>(PreferencesStore.getInstanceOrCreate<PreferencesStore>());
  // Resolved once: this cluster frame belongs to exactly one cluster for its
  // whole lifetime, and main keeps one pi session per cluster.
  const [clusterId] = useState<string | undefined>(() => getFrameClusterId());
  const [isLoading, _setLoading] = useState(() => window.sessionStorage.getItem(IS_LOADING_KEY) === "true");
  const [isAgentRunning, _setAgentRunning] = useState(false);
  const [autoApproveAll, _setAutoApproveAll] = useState(false);
  const [chatMessages, _setChatMessages] = useState<MessageObject[] | null>(null);
  const [sessionStats, _setSessionStats] = useState<SessionStats | undefined>(undefined);

  // The agent client keeps this cluster's chat in step with the pi agent in
  // main: show its transcript, and keep the spinner, the disabled input and the
  // Stop button in step with the run, including a run that was already going
  // when this page mounted.
  useEffect(() => {
    // Undefined so the first call also clears a spinner restored from
    // sessionStorage for a run that has ended.
    let wasRunning: boolean | undefined;
    const show = (chat: ChatViewState) => {
      _setChatMessages(chat.messages);
      _setAgentRunning(chat.isRunning);
      _setAutoApproveAll(chat.autoApprove);
      _setSessionStats(chat.stats);
      if (chat.isRunning !== wasRunning) {
        wasRunning = chat.isRunning;
        setLoading(chat.isRunning);
      }
    };
    const current = getAgentChat();
    if (current) show(current);
    return onAgentChat(show);
  }, []);

  const setLoading = (isLoading: boolean) => {
    _setLoading(isLoading);
    // Transient: kept in sessionStorage so a fresh app start never restores a
    // spinner for a run that is no longer active.
    window.sessionStorage.setItem(IS_LOADING_KEY, String(isLoading));
  };

  const addMessage = (message: MessageObject) => {
    editAgentTranscript((messages) => [...messages, message]);
  };

  const removeMessage = (messageId: string) => {
    editAgentTranscript((messages) => messages.filter((message) => message.messageId !== messageId));
  };

  // Drop any error messages still in the transcript. Called when the user takes
  // a fresh action (sends a new prompt) so a stale "Retry" button does not
  // linger once the conversation has moved on.
  const removeErrorMessages = () => {
    editAgentTranscript((messages) => {
      const kept = messages.filter((message) => !message.error);
      return kept.length === messages.length ? messages : kept;
    });
  };

  // New chat or Delete all chats: main stops a run and starts the cluster's new
  // pi session, and the agent client empties the transcript.
  const resetChat = async (type: "new_session" | "delete_sessions") => {
    const response = await resetAgentChat(clusterId, type);
    if (!response.success) {
      log.error("Starting a new chat failed: ", response.error);
    }
  };

  const clearChat = () => resetChat("new_session");
  const deleteAllChats = () => resetChat("delete_sessions");

  // Takes the picker's "provider/id"; main runs the next prompt on it.
  const setSelectedModel = (modelRef: string) => {
    preferencesStore.agentModel = modelRef;
  };

  // The run ends with the usual settled event, which clears the spinner.
  const stopAgent = async () => {
    const response = await sendAgentCommand(clusterId, { type: "abort" });
    if (!response.success) {
      log.error("Stopping the agent failed: ", response.error);
    }
  };

  // The chat runs in the cluster frame and the preferences live in the root
  // frame; `navigateToPreferences()` reaches the root frame from here, which
  // `Renderer.Navigation.navigate` cannot.
  const navigateToPreferences = () => extension.navigateToPreferences();

  const setExplainEvent = (messageObject: MessageObject) => {
    preferencesStore.explainEvent = messageObject;
  };

  const turnOffAutoApprove = async () => {
    const response = await turnOffAutoApproveInMain(clusterId);
    if (!response.success) {
      log.error("Turning off approve all failed: ", response.error);
    }
  };

  return (
    <AppContext.Provider
      value={{
        clusterId,
        autoApproveAll,
        explainEvent: preferencesStore.explainEvent,
        isLoading,
        isAgentRunning,
        chatMessages,
        sessionStats,
        setSelectedModel,
        setExplainEvent,
        turnOffAutoApprove,
        setLoading,
        stopAgent,
        addMessage,
        removeMessage,
        removeErrorMessages,
        clearChat,
        deleteAllChats,
        navigateToPreferences,
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
