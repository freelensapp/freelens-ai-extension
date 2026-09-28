import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import * as React from "react";
import {
  AIProviders,
  DEFAULT_ANTHROPIC_BASE_URL,
  defaultBaseUrl,
  PROVIDER_ENV_KEYS,
  PROVIDER_LABELS,
  type ProviderConfig,
} from "../../business/provider/ai-models";
import {
  addModel,
  addProvider,
  changeProviderType,
  removeModel,
  removeProvider,
  resolveSelection,
  updateProvider,
} from "../../business/provider/provider-list";

import type { SingleValue } from "react-select";

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

// Replace the provider list and keep the chat's selection valid: if the
// selected model or provider was removed, fall back to the first model left.
const setProviders = (preferencesStore: PreferencesStore, providers: ProviderConfig[]) => {
  preferencesStore.providers = providers;
  const selection = resolveSelection(providers, {
    providerId: preferencesStore.selectedProviderId,
    model: preferencesStore.selectedModel,
  });
  preferencesStore.selectedProviderId = selection.providerId;
  preferencesStore.selectedModel = selection.model;
};

const PROVIDER_DESCRIPTIONS: Record<AIProviders, string> = {
  [AIProviders.OPEN_AI]:
    "OpenAI or any service exposing the OpenAI Chat Completions API (LiteLLM, vLLM, Ollama, OpenRouter, OpenCode, ...).",
  [AIProviders.ANTHROPIC]: `Anthropic or any service exposing the Anthropic Messages API. The base URL excludes the "/v1" suffix, e.g. ${DEFAULT_ANTHROPIC_BASE_URL}.`,
};

interface ProviderCardProps {
  preferencesStore: PreferencesStore;
  provider: ProviderConfig;
}

const ProviderCard = observer(({ preferencesStore, provider }: ProviderCardProps) => {
  const [newModelName, setNewModelName] = useState<string>("");

  const update = (patch: Partial<Omit<ProviderConfig, "id">>) =>
    setProviders(preferencesStore, updateProvider(preferencesStore.providers, provider.id, patch));

  const handleAddModel = () => {
    // `addModel` trims the name and ignores empty/duplicate entries.
    setProviders(preferencesStore, addModel(preferencesStore.providers, provider.id, newModelName));
    setNewModelName("");
  };

  return (
    <div style={{ border: "1px solid var(--borderColor, #555)", borderRadius: 4, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: "bold" }}>Name</div>
          <Input
            placeholder={PROVIDER_LABELS[provider.type]}
            value={provider.name}
            onChange={(value: string) => update({ name: value })}
          />
        </div>
        <div style={{ minWidth: 220 }}>
          <div style={{ fontWeight: "bold" }}>API</div>
          <Select
            options={PROVIDER_OPTIONS}
            value={provider.type}
            onChange={(option: SingleValue<SelectOption<AIProviders>>) =>
              option &&
              setProviders(preferencesStore, changeProviderType(preferencesStore.providers, provider.id, option.value))
            }
            themeName="lens"
          />
        </div>
        <Icon
          material="delete"
          interactive
          tooltip="Remove provider"
          onClick={() => setProviders(preferencesStore, removeProvider(preferencesStore.providers, provider.id))}
        />
      </div>
      <div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>{PROVIDER_DESCRIPTIONS[provider.type]}</div>
      <div style={{ marginTop: 8, fontWeight: "bold" }}>Base URL</div>
      <Input
        placeholder={defaultBaseUrl(provider.type)}
        value={provider.baseUrl}
        onChange={(value: string) => update({ baseUrl: value })}
      />
      <div style={{ marginTop: 8, fontWeight: "bold" }}>API key</div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>
        The key itself, or {"{env:NAME}"} to read it from the NAME environment variable. When empty,{" "}
        {PROVIDER_ENV_KEYS[provider.type]} is used.
      </div>
      <Input
        type="password"
        placeholder="API key or {env:NAME}"
        value={provider.apiKey}
        onChange={(value: string) => update({ apiKey: value })}
      />
      <div style={{ marginTop: 8, fontWeight: "bold" }}>Models</div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>The model name is sent to the provider API.</div>
      {provider.models.map((model) => (
        <div key={model} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ flex: 1, fontFamily: "monospace" }}>{model}</span>
          <Icon
            material="delete"
            small
            interactive
            tooltip="Remove model"
            onClick={() => setProviders(preferencesStore, removeModel(preferencesStore.providers, provider.id, model))}
          />
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <div style={{ flex: 1 }}>
          <Input
            placeholder="Model name, e.g. gpt-5.5 or claude-sonnet-4-5"
            value={newModelName}
            onChange={(value: string) => setNewModelName(value)}
            onSubmit={handleAddModel}
          />
        </div>
        <Button primary label="Add model" onClick={handleAddModel} />
      </div>
    </div>
  );
});

export const PreferencesPage = observer(() => {
  const preferencesStore: PreferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  const [newProviderType, setNewProviderType] = useState<AIProviders>(AIProviders.OPEN_AI);

  const customAgentRulesField = useStoreValueOnBlur(
    preferencesStore.customAgentRules,
    (next) => (preferencesStore.customAgentRules = next),
  );
  const mcpConfigurationField = useStoreValueOnBlur(
    preferencesStore.mcpConfiguration,
    (next) => void preferencesStore.updateMcpConfiguration(next),
  );

  return (
    <>
      <div style={{ fontWeight: "bold", fontSize: 16 }}>Providers</div>
      <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
        Each provider is an endpoint with its own API, base URL, API key and models. The chat offers the models of every
        provider.
      </div>
      {preferencesStore.providers.map((provider) => (
        <ProviderCard key={provider.id} preferencesStore={preferencesStore} provider={provider} />
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ minWidth: 220 }}>
          <Select
            options={PROVIDER_OPTIONS}
            value={newProviderType}
            onChange={(option: SingleValue<SelectOption<AIProviders>>) =>
              setNewProviderType(option?.value ?? AIProviders.OPEN_AI)
            }
            themeName="lens"
          />
        </div>
        <Button
          primary
          label="Add provider"
          onClick={() => setProviders(preferencesStore, addProvider(preferencesStore.providers, newProviderType))}
        />
      </div>

      <HorizontalLine />

      <div style={{ fontWeight: "bold" }}>Reasoning effort</div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>
        Applied only to reasoning-capable models (o-series, gpt-5.x) of OpenAI-compatible providers.
      </div>
      <Select
        options={REASONING_EFFORT_OPTIONS}
        value={preferencesStore.openAIReasoningEffort}
        onChange={(option: SingleValue<SelectOption<string>>) =>
          (preferencesStore.openAIReasoningEffort = option?.value ?? "")
        }
        themeName="lens"
      />

      <HorizontalLine />

      <div style={{ fontWeight: "bold" }}>Disable thinking mode</div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>
        Ask every provider to turn off the model&apos;s thinking mode. Needed by some providers (e.g. DeepSeek via
        LiteLLM) whose thinking mode rejects some tool-call requests.
      </div>
      <Switch
        style={{ marginBottom: 8 }}
        label="Disable thinking mode"
        checked={preferencesStore.disableThinking}
        onChange={(checked: boolean) => (preferencesStore.disableThinking = checked)}
      />

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
        value={customAgentRulesField.value}
        onChange={(e) => customAgentRulesField.onChange(e.target.value)}
        onFocus={customAgentRulesField.onFocus}
        onBlur={customAgentRulesField.onBlur}
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
            value={mcpConfigurationField.value}
            onChange={(e) => mcpConfigurationField.onChange(e.target.value)}
            onFocus={mcpConfigurationField.onFocus}
            onBlur={mcpConfigurationField.onBlur}
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
