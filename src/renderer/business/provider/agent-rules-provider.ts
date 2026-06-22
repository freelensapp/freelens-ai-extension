import { PreferencesStore } from "../../../common/store";
import { appendCustomAgentRules } from "./agent-rules";

// Store-aware wrapper around `appendCustomAgentRules`: reads the custom agent
// rules from the preferences store and appends them to the given base prompt.
// Agents call this when building their system message so user-provided rules
// extend every session.
export const withCustomAgentRules = (basePrompt: string): string => {
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  return appendCustomAgentRules(basePrompt, preferencesStore.customAgentRules);
};
