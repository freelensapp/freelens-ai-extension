import { Renderer } from "@freelensapp/extensions";
import * as React from "react";
import { PreferencesStore } from "../../../common/store";
import { AIProviders } from "../../business/provider/ai-models";
import { useApplicationStatusStore } from "../../context/application-context";

import type { SingleValue } from "react-select";

const {
  Navigation: { navigate },
} = Renderer;

const { useEffect, useRef, useState } = React;

type TextInputHookProps = {
  onSend: (message: string) => void;
};

const MAX_ROWS = 5;

// A model is only offered in the dropdown if its provider has a usable key.
const hasKeyForProvider = (preferencesStore: PreferencesStore, provider: AIProviders): boolean => {
  switch (provider) {
    case AIProviders.OPEN_AI:
      return Boolean(process.env.OPENAI_API_KEY || preferencesStore.openAIKey);
    // case AIProviders.GOOGLE:
    //   return Boolean(process.env.GOOGLE_API_KEY || preferencesStore.googleAIKey);
    default:
      return false;
  }
};

export const useTextInput = ({ onSend }: TextInputHookProps) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  const applicationStatusStore = useApplicationStatusStore();

  // Only list models whose provider has a key configured.
  const modelSelections = preferencesStore.models
    .filter((model) => hasKeyForProvider(preferencesStore, model.provider))
    .map((model) => ({ value: model.name, label: model.name }));

  const hasAvailableModels = modelSelections.length > 0;

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

  const goToPreferences = () => navigate("/preferences");

  return {
    message,
    textareaRef,
    modelSelections,
    hasAvailableModels,
    setMessage,
    handleKeyDown,
    handleSend,
    onChangeModel,
    goToPreferences,
  };
};
