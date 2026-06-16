import { Renderer } from "@freelensapp/extensions";
import * as React from "react";
import { PreferencesStore } from "../../../common/store";
import { isAgentConfigured } from "../../business/provider/chat-readiness";
import { useApplicationStatusStore } from "../../context/application-context";
import { getExtensionPreferencesPath } from "../../navigation/extension-preferences";

import type { SingleValue } from "react-select";

const {
  Navigation: { navigate },
} = Renderer;

const { useEffect, useRef, useState } = React;

type TextInputHookProps = {
  onSend: (message: string) => void;
};

const MAX_ROWS = 5;

export const useTextInput = ({ onSend }: TextInputHookProps) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  const goToPreferences = () => navigate(getExtensionPreferencesPath());

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
