import { Renderer } from "@freelensapp/extensions";
import * as React from "react";
import { PreferencesStore } from "../../../common/store";
import { groupModels, resolvePickedModel } from "../../business/provider-client/model-picker";
import { onProviderEnvelope, sendProviderCommand } from "../../business/provider-client/provider-client";
import { useApplicationStatusStore } from "../../context/application-context";
import { navigateToExtensionPreferences } from "../../navigation/navigate-to-extension-preferences";

import type { SingleValue } from "react-select";

import type { ProviderModelSummary } from "../../../common/provider-protocol";

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

  // The models of the connected providers, from main; undefined until the
  // first list arrives. Reloaded whenever a login or logout changes them.
  const [models, setModels] = useState<ProviderModelSummary[] | undefined>(undefined);
  useEffect(() => {
    let latest = 0;
    let disposed = false;
    const load = async () => {
      const request = ++latest;
      const response = await sendProviderCommand({ type: "list_models" });
      // Only the newest list counts, and none after the input is gone.
      if (disposed || request !== latest) return;
      if (response.success) {
        setModels(response.data as ProviderModelSummary[]);
      } else {
        console.error("[freelens-ai] Listing the models of the connected providers failed:", response.error);
      }
    };
    void load();
    const stopListening = onProviderEnvelope((envelope) => {
      if (envelope.kind === "credentials_changed") void load();
    });
    return () => {
      disposed = true;
      stopListening();
    };
  }, []);

  const modelSelections = models ? groupModels(models) : [];
  const pickedModel = models ? resolvePickedModel(models, preferencesStore.agentModel) : undefined;

  // Remember the model the picker falls back to, so main runs the one shown:
  // the first listed when none was chosen yet or the chosen one went away.
  useEffect(() => {
    if (pickedModel && pickedModel !== preferencesStore.agentModel) {
      applicationStatusStore.setSelectedModel(pickedModel);
    }
  }, [pickedModel, preferencesStore.agentModel]);

  // Show the model picker only when a provider is connected. Otherwise the UI
  // explains that one has to be connected and links to this extension's settings.
  const agentConfigured = modelSelections.length > 0;
  const noProviderConnected = models !== undefined && models.length === 0;

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
    pickedModel,
    noProviderConnected,
    agentConfigured,
    setMessage,
    handleKeyDown,
    handleSend,
    onChangeModel,
    goToPreferences,
  };
};
