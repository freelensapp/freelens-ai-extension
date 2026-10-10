import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import * as React from "react";
import { ProviderSettings } from "./provider-settings";

import type { SingleValue } from "react-select";

const { observer } = MobxReact;
const { useCallback, useEffect, useRef, useState } = React;

import { DEFAULT_CHAT_RETENTION_DAYS } from "../../../common/agent-protocol";
import { AGENT_TOOLS } from "../../../common/agent-tools";
import { requiresApproval, withApprovalOverride } from "../../../common/agent-tools/approval-settings";
import { DEFAULT_POD_LOGS_TAIL_LINES, PreferencesStore, parseRetentionDays } from "../../../common/store";

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
  Component: { Input, Select, Switch, HorizontalLine },
} = Renderer;

type SelectOption<T> = Renderer.Component.SelectOption<T>;

const REASONING_EFFORT_OPTIONS: SelectOption<string>[] = [
  { value: "", label: "Default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const PreferencesPage = observer(() => {
  const preferencesStore: PreferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  // Committed on blur, so the field can be emptied while typing a new number.
  const chatRetentionField = useStoreValueOnBlur(
    String(preferencesStore.chatRetentionDays),
    (next) => (preferencesStore.chatRetentionDays = parseRetentionDays(Number.parseInt(next, 10))),
  );
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
      <ProviderSettings />

      <HorizontalLine />

      {/* Still read by AI Explain, which runs on the old OpenAI client until it moves to pi. */}
      <div style={{ fontWeight: "bold", fontSize: 16 }}>AI Explain</div>
      <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
        AI Explain uses the OpenAI API key from the OpenAI provider above, or OPENAI_API_KEY.
      </div>
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

      <div style={{ fontWeight: "bold", fontSize: 16 }}>Chats</div>
      <div style={{ marginTop: 8, fontWeight: "bold" }}>Delete chats older than N days</div>
      <div style={{ fontSize: 12, marginBottom: 4, opacity: 0.7 }}>
        Saved chats not used for this many days are deleted when Freelens starts and on New chat. The open chat of each
        cluster is kept. 0 keeps chats forever.
      </div>
      <Input
        type="number"
        min={0}
        placeholder={String(DEFAULT_CHAT_RETENTION_DAYS)}
        value={chatRetentionField.value}
        onChange={chatRetentionField.onChange}
        onFocus={chatRetentionField.onFocus}
        onBlur={chatRetentionField.onBlur}
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

      <div style={{ fontWeight: "bold", fontSize: 16 }}>Tool approvals</div>
      <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
        The agent asks before each call of a tool that requires approval. Tools that change the cluster require it by
        default, and so does reading pod logs, which can contain secrets or personal data. A change applies to the next
        call.
      </div>
      {AGENT_TOOLS.map((tool) => (
        <div key={tool.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ flex: 1, fontFamily: "monospace" }}>{tool.name}</span>
          <span style={{ minWidth: 110, fontSize: 12, opacity: 0.7 }}>
            {tool.mutating ? "Changes the cluster" : "Reads the cluster"}
          </span>
          <Switch
            label="Requires approval"
            checked={requiresApproval(tool, preferencesStore.toolApprovalOverrides)}
            onChange={(checked: boolean) =>
              (preferencesStore.toolApprovalOverrides = withApprovalOverride(
                preferencesStore.toolApprovalOverrides,
                tool,
                checked,
              ))
            }
          />
        </div>
      ))}

      <HorizontalLine />

      <div style={{ fontWeight: "bold", fontSize: 16 }}>Pod logs</div>
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
