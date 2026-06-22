import { Renderer } from "@freelensapp/extensions";
import * as React from "react";
import { PreferencesStore } from "../../../common/store";
import { isAgentConfigured } from "../../business/provider/chat-readiness";
import { useApplicationStatusStore } from "../../context/application-context";
import { navigateToExtensionPreferences } from "../../navigation/navigate-to-extension-preferences";

import type { SingleValue } from "react-select";

const { useCallback, useEffect, useRef, useState } = React;

type TextInputHookProps = {
  onSend: (message: string) => void;
};

const MAX_ROWS = 5;

// Persist the unsent draft so switching to another view (e.g. the Pods list)
// and back does not discard what the user has typed.
const DRAFT_STORAGE_KEY = "chatInputDraft";

export const useTextInput = ({ onSend }: TextInputHookProps) => {
  const [message, _setMessage] = useState(() => window.sessionStorage.getItem(DRAFT_STORAGE_KEY) ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setMessage = useCallback((value: string) => {
    _setMessage(value);
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, value);
  }, []);
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  const applicationStatusStore = useApplicationStatusStore();

  const modelSelections = preferencesStore.models.map((model) => ({ value: model.name, label: model.name }));

  // Show the model dropdown only when the agent is ready to chat. Otherwise
  // (no models left, or no OpenAI key set) the UI offers a single button that
  // links to this extension's preferences.
  const agentConfigured = isAgentConfigured({
    models: preferencesStore.models,
    selectedModel: preferencesStore.selectedModel,
    openAIKey: preferencesStore.openAIKey,
    envOpenAIKey: typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined,
  });

  const adaptTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.rows = 1;

    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight, 10);
    const neededRows = Math.ceil(textarea.scrollHeight / lineHeight);

    textarea.rows = Math.min(neededRows, MAX_ROWS);
  };

  useEffect(() => {
    adaptTextareaHeight();
  }, [message]);

  const handleSend = () => {
    if (!applicationStatusStore.isLoading && message.trim()) {
      onSend(message.trim());
      setMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const onChangeModel = (option: SingleValue<Renderer.Component.SelectOption<string>>) => {
    if (option) {
      applicationStatusStore.setSelectedModel(option.value);
    }
  };

  const goToPreferences = () => navigateToExtensionPreferences();

  return {
    message,
    textareaRef,
    modelSelections,
    agentConfigured,
    setMessage,
    handleKeyDown,
    handleSend,
    onChangeModel,
    goToPreferences,
  };
};
