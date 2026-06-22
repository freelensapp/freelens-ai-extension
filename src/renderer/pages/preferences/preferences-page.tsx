import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import * as React from "react";
import { AIProviders, DEFAULT_MODELS, PROVIDER_LABELS } from "../../business/provider/ai-models";
import { addModel, removeModelAt, resolveSelectedModel } from "../../business/provider/model-list";

import type { SingleValue } from "react-select";

const { observer } = MobxReact;
const { useCallback, useEffect, useMemo, useRef, useState } = React;

import { DEFAULT_POD_LOGS_TAIL_LINES, PreferencesStore } from "../../../common/store";
import { debounce } from "../../../common/utils/debounce";

/** Writes are throttled while typing stays responsive. */
const STORE_WRITE_DEBOUNCE_MS = 500;

/**
 * Binds a controlled text field to a store value while throttling writes.
 *
 * The returned draft updates immediately so typing stays responsive, but the
 * `commit` callback fires at most once per {@link STORE_WRITE_DEBOUNCE_MS}
 * (trailing edge), avoiding an expensive store/disk write on every keystroke.
 */
function useDebouncedStoreValue(value: string, commit: (next: string) => void): [string, (next: string) => void] {
  const [draft, setDraft] = useState<string>(value);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const debouncedCommit = useMemo(
    () => debounce((next: string) => commitRef.current(next), STORE_WRITE_DEBOUNCE_MS),
    [],
  );

  // Reflect external changes (e.g. when the store is loaded or reset elsewhere).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Flush any pending write so the last edit is not lost on unmount.
  useEffect(() => () => debouncedCommit.flush(), [debouncedCommit]);

  const onChange = useCallback(
    (next: string) => {
      setDraft(next);
      debouncedCommit(next);
    },
    [debouncedCommit],
  );

  return [draft, onChange];
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

  const [customAgentRules, setCustomAgentRules] = useDebouncedStoreValue(
    preferencesStore.customAgentRules,
    (next) => (preferencesStore.customAgentRules = next),
  );
  const [mcpConfiguration, setMcpConfiguration] = useDebouncedStoreValue(
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
      <div style={{ fontWeight: "bold", fontSize: 16 }}>OpenAI</div>
      <div style={{ marginTop: 8, fontWeight: "bold" }}>API key</div>
      <Input
        type="password"
        placeholder="Put here your OpenAI API key"
        value={preferencesStore.openAIKey}
        onChange={(value: string) => (preferencesStore.openAIKey = value)}
      />
      <div style={{ marginTop: 8, fontWeight: "bold" }}>Base URL</div>
      <Input
        placeholder="https://api.openai.com/v1"
        value={preferencesStore.openAIBaseUrl}
        onChange={(value: string) => (preferencesStore.openAIBaseUrl = value)}
      />
      <div style={{ marginTop: 8, fontWeight: "bold" }}>Reasoning effort</div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>
        Applied only to reasoning-capable models (o-series, gpt-5.x).
      </div>
      <Select
        options={REASONING_EFFORT_OPTIONS}
        value={preferencesStore.openAIReasoningEffort}
        onChange={(option: SingleValue<SelectOption<string>>) =>
          (preferencesStore.openAIReasoningEffort = option?.value ?? "")
        }
        themeName="lens"
      />
      <div style={{ marginTop: 8, fontWeight: "bold" }}>Disable thinking mode</div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>
        Turn off the model&apos;s thinking mode. Required by some providers (e.g. DeepSeek via LiteLLM) whose thinking
        mode conflicts with the forced tool selection used for structured output.
      </div>
      <Switch
        style={{ marginBottom: 8 }}
        label="Disable thinking mode"
        checked={preferencesStore.disableThinking}
        onChange={(checked: boolean) => (preferencesStore.disableThinking = checked)}
      />

      <HorizontalLine />

      <div style={{ fontWeight: "bold", fontSize: 16 }}>Models</div>
      <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
        Add or remove the models offered in the chat. The model name is sent to the provider API.
      </div>
      {preferencesStore.models.map((model, index) => (
        <div
          key={`${model.provider}/${model.name}`}
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
        >
          <span style={{ minWidth: 80, opacity: 0.7 }}>{PROVIDER_LABELS[model.provider] ?? model.provider}</span>
          <span style={{ flex: 1, fontFamily: "monospace" }}>{model.name}</span>
          <Icon material="delete" small interactive tooltip="Remove model" onClick={() => removeModel(index)} />
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <div style={{ minWidth: 120 }}>
          <Select
            options={PROVIDER_OPTIONS}
            value={newModelProvider}
            onChange={(option: SingleValue<SelectOption<AIProviders>>) =>
              setNewModelProvider(option?.value ?? AIProviders.OPEN_AI)
            }
            themeName="lens"
          />
        </div>
        <div style={{ flex: 1 }}>
          <Input
            placeholder="Model name, e.g. gpt-5.5"
            value={newModelName}
            onChange={(value: string) => setNewModelName(value)}
            onSubmit={handleAddModel}
          />
        </div>
        <Button primary label="Add" onClick={handleAddModel} />
      </div>
      <div style={{ marginTop: 8 }}>
        <Button plain label="Reset to defaults" onClick={resetModels} />
      </div>

      <HorizontalLine />

      <div style={{ fontWeight: "bold", fontSize: 16 }}>Agent rules</div>
      <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
        Extra rules appended to the agent system message at the start of every session. Use them to set your own
        conventions, preferences, or constraints. Leave empty to use the built-in rules only.
      </div>
      <textarea
        style={{
          width: "100%",
          minHeight: 150,
          fontFamily: "monospace",
          fontSize: 14,
          padding: 8,
          borderRadius: 4,
          border: "1px solid #ccc",
          background: "#222",
          color: "#fff",
        }}
        placeholder="e.g. Always answer in English. Prefer kubectl examples over Helm."
        value={customAgentRules}
        onChange={(e) => setCustomAgentRules(e.target.value)}
      />

      <HorizontalLine />
      <div>
        <div style={{ fontWeight: "bold" }}>Enable MCP</div>
        <Switch
          style={{ marginBottom: 8 }}
          label="Enable MCP"
          checked={preferencesStore.mcpEnabled}
          onChange={(checked: boolean) => (preferencesStore.mcpEnabled = checked)}
        />
        <div>
          <div style={{ marginBottom: 8, fontWeight: "bold" }}>MCP JSON Configuration</div>
          <textarea
            style={{
              width: "100%",
              minHeight: 250,
              fontFamily: "monospace",
              fontSize: 14,
              padding: 8,
              borderRadius: 4,
              border: "1px solid #ccc",
              background: "#222",
              color: "#fff",
            }}
            placeholder="Paste or edit your MCP JSON configuration here"
            value={mcpConfiguration}
            onChange={(e) => setMcpConfiguration(e.target.value)}
          />
        </div>
      </div>

      <HorizontalLine />

      <div style={{ fontWeight: "bold", fontSize: 16 }}>Pod logs</div>
      <div style={{ marginTop: 8, fontWeight: "bold" }}>Require approval before reading pod logs</div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>
        Pod logs can contain secrets or personal data. When enabled, the agent asks for confirmation before reading
        container logs.
      </div>
      <Switch
        style={{ marginBottom: 8 }}
        label="Require approval before reading pod logs"
        checked={preferencesStore.podLogsRequireApproval}
        onChange={(checked: boolean) => (preferencesStore.podLogsRequireApproval = checked)}
      />
      <div style={{ marginTop: 8, fontWeight: "bold" }}>Default tail lines</div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>
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
