import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import * as React from "react";
import { AIProviders, DEFAULT_MODELS, PROVIDER_LABELS } from "../../../common/provider/ai-models";
import { addModel, removeModelAt, resolveSelectedModel } from "../../../common/provider/model-list";
import styles from "./preferences-page.module.scss";

const { observer } = MobxReact;
const { useCallback, useEffect, useRef, useState } = React;

import { DEFAULT_POD_LOGS_TAIL_LINES, PreferencesStore } from "../../../common/store";

interface DraftFieldProps {
  value: string;
  onChange: (next: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * Binds a controlled text field to a store value, committing only on blur.
 *
 * Writing to the persisted store on every keystroke is expensive and, because
 * the store value flows back into the controlled element, repositions the caret
 * to the end mid-typing. Instead the draft updates locally while editing and the
 * `commit` callback fires once when the field loses focus. A focus guard keeps
 * external store updates from clobbering an in-progress edit, and any pending
 * draft is flushed on unmount so the last edit is never lost.
 */
function useStoreValueOnBlur(value: string, commit: (next: string) => void): DraftFieldProps {
  const [draft, setDraft] = useState<string>(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const valueRef = useRef(value);
  valueRef.current = value;
  const focusedRef = useRef(false);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Reflect external changes (store load/reset) only while not editing, so a
  // blur commit (which updates the store) never moves the caret.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  // Flush a pending draft on unmount in case the field never blurred.
  useEffect(
    () => () => {
      if (draftRef.current !== valueRef.current) commitRef.current(draftRef.current);
    },
    [],
  );

  const onChange = useCallback((next: string) => setDraft(next), []);
  const onFocus = useCallback(() => {
    focusedRef.current = true;
  }, []);
  const onBlur = useCallback(() => {
    focusedRef.current = false;
    if (draftRef.current !== valueRef.current) commitRef.current(draftRef.current);
  }, []);

  return { value: draft, onChange, onFocus, onBlur };
}

const {
  Component: { Button, Icon, Input, Select, Switch, HorizontalLine },
} = Renderer;

type SelectOption<T> = Renderer.Component.SelectOption<T>;

const REASONING_EFFORT_OPTIONS: SelectOption<string>[] = [
  { value: "", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const PROVIDER_OPTIONS: SelectOption<AIProviders>[] = Object.values(AIProviders).map((provider) => ({
  value: provider,
  label: PROVIDER_LABELS[provider],
}));

export const PreferencesPage = observer(() => {
  const preferencesStore: PreferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  const [newModelProvider, setNewModelProvider] = useState<AIProviders>(AIProviders.OPEN_AI);
  const [newModelName, setNewModelName] = useState<string>("");

  const customAgentRulesField = useStoreValueOnBlur(
    preferencesStore.customAgentRules,
    (next) => (preferencesStore.customAgentRules = next),
  );
  const mcpConfigurationField = useStoreValueOnBlur(
    preferencesStore.mcpConfiguration,
    (next) => void preferencesStore.updateMcpConfiguration(next),
  );

  const handleAddModel = () => {
    // `addModel` trims the name and ignores empty/duplicate entries.
    preferencesStore.models = addModel(preferencesStore.models, newModelProvider, newModelName);
    setNewModelName("");
  };

  const removeModel = (index: number) => {
    preferencesStore.models = removeModelAt(preferencesStore.models, index);
    // Re-validate the selection: if the removed entry was selected, fall back
    // to a valid model (or "" when the list is now empty).
    preferencesStore.selectedModel = resolveSelectedModel(preferencesStore.models, preferencesStore.selectedModel);
  };

  const resetModels = () => {
    preferencesStore.models = [...DEFAULT_MODELS];
    preferencesStore.selectedModel = resolveSelectedModel(preferencesStore.models, preferencesStore.selectedModel);
  };

  return (
    <>
      <div className={styles.sectionTitle}>OpenAI</div>
      <div className={styles.label}>API key</div>
      <Input
        type="password"
        placeholder="Put here your OpenAI API key"
        value={preferencesStore.openAIKey}
        onChange={(value: string) => (preferencesStore.openAIKey = value)}
      />
      <div className={styles.label}>Base URL</div>
      <Input
        placeholder="https://api.openai.com/v1"
        value={preferencesStore.openAIBaseUrl}
        onChange={(value: string) => (preferencesStore.openAIBaseUrl = value)}
      />
      <div className={styles.label}>Reasoning effort</div>
      <div className={styles.hint}>Applied only to reasoning-capable models (o-series, gpt-5.x, gpt-6.x).</div>
      <Select
        options={REASONING_EFFORT_OPTIONS}
        value={preferencesStore.openAIReasoningEffort}
        onChange={(option: SelectOption<string> | null) =>
          (preferencesStore.openAIReasoningEffort = option?.value ?? "")
        }
        themeName="lens"
      />
      <div className={styles.label}>Disable thinking mode</div>
      <div className={styles.hint}>
        Turn off the model&apos;s thinking mode. Required by some providers (e.g. DeepSeek via LiteLLM) whose thinking
        mode conflicts with the forced tool selection used for structured output.
      </div>
      <Switch
        className={styles.switch}
        label="Disable thinking mode"
        checked={preferencesStore.disableThinking}
        onChange={(checked: boolean) => (preferencesStore.disableThinking = checked)}
      />

      <HorizontalLine />

      <div className={styles.sectionTitle}>Models</div>
      <div className={styles.sectionHint}>
        Add or remove the models offered in the chat. The model name is sent to the provider API.
      </div>
      {preferencesStore.models.map((model, index) => (
        <div key={`${model.provider}/${model.name}`} className={styles.modelRow}>
          <span className={styles.modelProvider}>{PROVIDER_LABELS[model.provider] ?? model.provider}</span>
          <span className={styles.modelName}>{model.name}</span>
          <Icon material="delete" small interactive tooltip="Remove model" onClick={() => removeModel(index)} />
        </div>
      ))}
      <div className={styles.addModelRow}>
        <div className={styles.addModelProvider}>
          <Select
            options={PROVIDER_OPTIONS}
            value={newModelProvider}
            onChange={(option: SelectOption<AIProviders> | null) =>
              setNewModelProvider(option?.value ?? AIProviders.OPEN_AI)
            }
            themeName="lens"
          />
        </div>
        <div className={styles.addModelName}>
          <Input
            placeholder="Model name, e.g. gpt-6.1-sol"
            value={newModelName}
            onChange={(value: string) => setNewModelName(value)}
            onSubmit={handleAddModel}
          />
        </div>
        <Button primary label="Add" onClick={handleAddModel} />
      </div>
      <div className={styles.resetModels}>
        <Button plain label="Reset to defaults" onClick={resetModels} />
      </div>

      <HorizontalLine />

      <div className={styles.sectionTitle}>Agent rules</div>
      <div className={styles.sectionHint}>
        Extra rules appended to the agent system message at the start of every session. Use them to set your own
        conventions, preferences, or constraints. Leave empty to use the built-in rules only.
      </div>
      <textarea
        className={`${styles.textarea} ${styles.agentRules}`}
        placeholder="e.g. Always answer in English. Prefer kubectl examples over Helm."
        value={customAgentRulesField.value}
        onChange={(e) => customAgentRulesField.onChange(e.target.value)}
        onFocus={customAgentRulesField.onFocus}
        onBlur={customAgentRulesField.onBlur}
      />

      <HorizontalLine />
      <div>
        <div className={styles.mcpEnabledLabel}>Enable MCP</div>
        <Switch
          className={styles.switch}
          label="Enable MCP"
          checked={preferencesStore.mcpEnabled}
          onChange={(checked: boolean) => (preferencesStore.mcpEnabled = checked)}
        />
        <div>
          <div className={styles.mcpConfigurationLabel}>MCP JSON Configuration</div>
          <textarea
            className={`${styles.textarea} ${styles.mcpConfiguration}`}
            placeholder="Paste or edit your MCP JSON configuration here"
            value={mcpConfigurationField.value}
            onChange={(e) => mcpConfigurationField.onChange(e.target.value)}
            onFocus={mcpConfigurationField.onFocus}
            onBlur={mcpConfigurationField.onBlur}
          />
        </div>
      </div>

      <HorizontalLine />

      <div className={styles.sectionTitle}>Pod logs</div>
      <div className={styles.label}>Require approval before reading pod logs</div>
      <div className={styles.hint}>
        Pod logs can contain secrets or personal data. When enabled, the agent asks for confirmation before reading
        container logs.
      </div>
      <Switch
        className={styles.switch}
        label="Require approval before reading pod logs"
        checked={preferencesStore.podLogsRequireApproval}
        onChange={(checked: boolean) => (preferencesStore.podLogsRequireApproval = checked)}
      />
      <div className={styles.label}>Default tail lines</div>
      <div className={styles.hint}>
        Number of lines read from the end of the logs when the agent does not request a specific amount.
      </div>
      <Input
        type="number"
        placeholder={String(DEFAULT_POD_LOGS_TAIL_LINES)}
        value={String(preferencesStore.podLogsTailLines)}
        onChange={(value: string) => {
          const parsed = Number.parseInt(value, 10);
          preferencesStore.podLogsTailLines =
            Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POD_LOGS_TAIL_LINES;
        }}
      />
    </>
  );
});
