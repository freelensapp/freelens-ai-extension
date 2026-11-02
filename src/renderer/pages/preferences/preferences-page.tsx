import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { ClusterProfileTable } from "../../components/cluster-profile/cluster-profile-table";
import { PolicyProfileSettings } from "./policy-profiles/policy-profile-settings";
import styles from "./preferences-page.module.scss";
import { ProviderSettings } from "./provider-settings";
import { useStoreValueOnBlur } from "./use-store-value-on-blur";

import type { SingleValue } from "react-select";

const { observer } = MobxReact;

import { DEFAULT_CHAT_RETENTION_DAYS } from "../../../common/agent-protocol";
import { DEFAULT_POD_LOGS_TAIL_LINES, PreferencesStore, parseRetentionDays } from "../../../common/store";
import { THINKING_LEVELS, type ThinkingLevel } from "../../../common/thinking-level";

const {
  Component: { Input, Select, HorizontalLine },
} = Renderer;

type SelectOption<T> = Renderer.Component.SelectOption<T>;

const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

const THINKING_LEVEL_OPTIONS: SelectOption<ThinkingLevel>[] = THINKING_LEVELS.map((level) => ({
  value: level,
  label: THINKING_LEVEL_LABELS[level],
}));

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

  return (
    <>
      <ProviderSettings />

      <HorizontalLine />

      <div style={{ fontWeight: "bold", fontSize: 16 }}>Thinking level</div>
      <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
        How much the model reasons before it answers, for every chat and AI Explain. Higher levels are slower and cost
        more. Models that support fewer levels use the closest one; models without reasoning ignore it.
      </div>
      <Select
        id="thinking-level"
        options={THINKING_LEVEL_OPTIONS}
        value={preferencesStore.thinkingLevel}
        onChange={(option: SingleValue<SelectOption<ThinkingLevel>>) => {
          if (option) preferencesStore.thinkingLevel = option.value;
        }}
        themeName="lens"
      />

      <HorizontalLine />

      <div style={{ fontWeight: "bold", fontSize: 16 }}>Agent rules</div>
      <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>
        Extra rules appended to the agent system message at the start of every session. Use them to set your own
        conventions, preferences, or constraints. Leave empty to use the built-in rules only.
      </div>
      <textarea
        className={styles.agentRules}
        placeholder="e.g. Always answer in English. Prefer kubectl examples over Helm."
        value={customAgentRulesField.value}
        onChange={(e) => customAgentRulesField.onChange(e.target.value)}
        onFocus={customAgentRulesField.onFocus}
        onBlur={customAgentRulesField.onBlur}
      />

      <HorizontalLine />

      <PolicyProfileSettings />

      <HorizontalLine />

      <ClusterProfileTable />

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
