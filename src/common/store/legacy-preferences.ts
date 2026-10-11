// The preference fields of the LangChain agent. Nothing reads them any more
// except the one-time imports in main, which move them into pi. Kept free of
// host and MobX imports so it is unit-tested alone.

export const LEGACY_PREFERENCE_KEYS = [
  "openAIKey",
  "openAIBaseUrl",
  "openAIReasoningEffort",
  "disableThinking",
  "aiProxyPort",
  "aiProxyToken",
  "selectedModel",
  "models",
  "podLogsRequireApproval",
  "mcpEnabled",
  "mcpConfiguration",
] as const;

export type LegacyPreferenceKey = (typeof LEGACY_PREFERENCE_KEYS)[number];

/** The old fields as found in the store file; `null` once cleared. */
export type LegacyPreferences = Partial<Record<LegacyPreferenceKey, unknown>>;

/** The old fields present in a saved store, `null` ones included. */
export function pickLegacyPreferences(saved: object): LegacyPreferences {
  const values = saved as Record<string, unknown>;
  const legacy: LegacyPreferences = {};
  for (const key of LEGACY_PREFERENCE_KEYS) {
    if (values[key] !== undefined) legacy[key] = values[key];
  }
  return legacy;
}

/**
 * The same fields set to `null`. Freelens saves a store key by key, so a field
 * left out of the saved model would stay in the file; `null` overwrites it.
 */
export function clearedLegacyPreferences(legacy: LegacyPreferences): LegacyPreferences {
  return Object.fromEntries(Object.keys(legacy).map((key) => [key, null]));
}

/** Whether any old field still holds a value. */
export const hasLegacyValues = (legacy: LegacyPreferences): boolean =>
  Object.values(legacy).some((value) => value !== null);

export interface LegacyOpenAISettings {
  openAIKey: string;
  openAIBaseUrl: string;
  selectedModel: string;
  /** The names of the old editable model list. */
  modelNames: string[];
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/** The old OpenAI settings the credential imports read, empty when absent or cleared. */
export function legacyOpenAISettings(legacy: LegacyPreferences): LegacyOpenAISettings {
  const models = Array.isArray(legacy.models) ? legacy.models : [];
  return {
    openAIKey: asString(legacy.openAIKey),
    openAIBaseUrl: asString(legacy.openAIBaseUrl),
    selectedModel: asString(legacy.selectedModel),
    modelNames: models
      .map((model) => (typeof model === "object" && model !== null ? asString((model as { name?: unknown }).name) : ""))
      .filter((name) => name.trim() !== ""),
  };
}
