// The global thinking level of the chat. Kept free of host and MobX imports so
// main, the settings page and the store share it and it is unit-tested alone.

/** The levels the settings offer; pi clamps the chosen one to what each model supports. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

const isThinkingLevel = (value: unknown): value is ThinkingLevel => THINKING_LEVELS.includes(value as ThinkingLevel);

export interface SavedThinkingSettings {
  thinkingLevel?: unknown;
  /** The old reasoning-effort select; read only until `thinkingLevel` is saved. */
  openAIReasoningEffort?: unknown;
  /** The old "Disable thinking mode" switch; read only until `thinkingLevel` is saved. */
  disableThinking?: unknown;
}

/**
 * The saved level. Before one is saved, the old reasoning-effort select and
 * "Disable thinking mode" switch are imported, so an upgrade keeps the choice.
 */
export const loadThinkingLevel = (saved: SavedThinkingSettings): ThinkingLevel => {
  if (saved.thinkingLevel !== undefined) {
    return isThinkingLevel(saved.thinkingLevel) ? saved.thinkingLevel : DEFAULT_THINKING_LEVEL;
  }
  if (saved.disableThinking === true) return "off";
  return isThinkingLevel(saved.openAIReasoningEffort) ? saved.openAIReasoningEffort : DEFAULT_THINKING_LEVEL;
};
