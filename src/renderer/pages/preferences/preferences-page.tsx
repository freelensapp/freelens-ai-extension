// @ts-ignore
import React from "react";

import { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { PreferencesStore } from "../../../common/store";

const {
  Component: { Input, Switch },
} = Renderer;

export const PreferencesPage = observer(() => {
  const preferencesStore = PreferencesStore.getInstance();

  return (
    <>
      <div style={{ marginBottom: 8, fontWeight: "bold" }}>API Key</div>
      <Input
        placeholder="Set here your API key"
        value={preferencesStore.apiKey}
        onChange={(value: string) => (preferencesStore.apiKey = value)}
      />
      <div style={{ marginTop: 24 }}>
        <div style={{ marginBottom: 8, fontWeight: "bold" }}>Enable MCP</div>
        <Switch
          label="Enable MCP"
          checked={preferencesStore.mcpEnabled}
          onChange={(checked: boolean) => (preferencesStore.mcpEnabled = checked)}
        />
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: "bold" }}>MCP JSON Configuration</div>
          <textarea
            style={{
              width: "100%",
              minHeight: 100,
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
            onChange={async (e) => await preferencesStore.updateMcpConfiguration(e.target.value)}
          />
        </div>
      </div>
    </>
  );
});
