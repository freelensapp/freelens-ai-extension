import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import * as React from "react";
import { AIProviders, DEFAULT_MODELS, PROVIDER_LABELS } from "../../business/provider/ai-models";

import type { SingleValue } from "react-select";

const { observer } = MobxReact;
const { useState } = React;

import { PreferencesStore } from "../../../common/store";

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

  const addModel = () => {
    const name = newModelName.trim();
    if (!name) return;
    // Avoid duplicates of the same provider + model name.
    if (preferencesStore.models.some((model) => model.provider === newModelProvider && model.name === name)) {
      setNewModelName("");
      return;
    }
    preferencesStore.models = [...preferencesStore.models, { provider: newModelProvider, name }];
    setNewModelName("");
  };

  const removeModel = (index: number) => {
    const removed = preferencesStore.models[index];
    preferencesStore.models = preferencesStore.models.filter((_, i) => i !== index);
    // If the removed entry was selected, fall back to a valid model.
    if (removed?.name === preferencesStore.selectedModel) {
      preferencesStore.selectedModel = preferencesStore.models[0]?.name ?? "";
    }
  };

  const resetModels = () => {
    preferencesStore.models = [...DEFAULT_MODELS];
    if (!preferencesStore.models.some((model) => model.name === preferencesStore.selectedModel)) {
      preferencesStore.selectedModel = preferencesStore.models[0]?.name ?? "";
    }
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
            onSubmit={addModel}
          />
        </div>
        <Button primary label="Add" onClick={addModel} />
      </div>
      <div style={{ marginTop: 8 }}>
        <Button plain label="Reset to defaults" onClick={resetModels} />
      </div>

      {/*<HorizontalLine />*/}
      {/*<div>*/}
      {/*  <SubTitle title="Ollama settings" />*/}
      {/*  If you're using Ollama, there's no need for an API key.*/}
      {/*  <div style={{ marginTop: 8, fontWeight: "bold" }}>Ollama host</div>*/}
      {/*  <Input*/}
      {/*    style={{ marginBottom: 8 }}*/}
      {/*    placeholder="Set here your ollama host"*/}
      {/*    value={preferencesStore.ollamaHost}*/}
      {/*    onChange={(value: string) => (preferencesStore.ollamaHost = value)}*/}
      {/*  />*/}
      {/*  <div style={{ marginTop: 8, fontWeight: "bold" }}>Ollama port</div>*/}
      {/*  <Input*/}
      {/*    placeholder="Set here your ollama port"*/}
      {/*    value={preferencesStore.ollamaPort}*/}
      {/*    onChange={(value: string) => (preferencesStore.ollamaPort = value)}*/}
      {/*  />*/}
      {/*</div>*/}

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
            value={preferencesStore.mcpConfiguration}
            onChange={async (e) => preferencesStore.updateMcpConfiguration(e.target.value).then(() => {})}
          />
        </div>
      </div>
    </>
  );
});
