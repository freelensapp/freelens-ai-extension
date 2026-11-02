import { describe, expect, it } from "vitest";
import {
  APPROVAL_CHOICE_KEYS,
  clearedLegacyPreferences,
  hasLegacyValues,
  legacyOpenAISettings,
  mergeLegacyPreferences,
  pickLegacyPreferences,
} from "./legacy-preferences";

const oldStore = {
  openAIKey: "sk-old",
  openAIBaseUrl: "https://llm.example.com/v1",
  selectedModel: "gpt-5.4",
  models: [
    { provider: "openai", name: "gpt-5.5" },
    { provider: "openai", name: " " },
  ],
  aiProxyPort: 4321,
  mcpEnabled: false,
  bypassApprovals: true,
  customAgentRules: "Answer in Italian",
  agentModel: "openai/gpt-5.4",
};

describe("pickLegacyPreferences", () => {
  it("keeps only the old fields present in the store", () => {
    expect(pickLegacyPreferences(oldStore)).toEqual({
      openAIKey: "sk-old",
      openAIBaseUrl: "https://llm.example.com/v1",
      selectedModel: "gpt-5.4",
      models: oldStore.models,
      aiProxyPort: 4321,
      mcpEnabled: false,
      bypassApprovals: true,
    });
  });

  it("finds nothing in a store saved after the upgrade", () => {
    expect(pickLegacyPreferences({ customAgentRules: "", agentModel: "openai/gpt-5.5" })).toEqual({});
  });
});

describe("clearedLegacyPreferences", () => {
  it("sets every present field to null so saving overwrites it", () => {
    const cleared = clearedLegacyPreferences(pickLegacyPreferences(oldStore));
    expect(cleared).toEqual({
      openAIKey: null,
      openAIBaseUrl: null,
      selectedModel: null,
      models: null,
      aiProxyPort: null,
      mcpEnabled: null,
      bypassApprovals: null,
    });
    expect(hasLegacyValues(cleared)).toBe(false);
  });

  it("sets only the fields of one import to null, and keeps the others", () => {
    const legacy = pickLegacyPreferences({ ...oldStore, toolApprovalOverrides: { getPodLogs: false } });
    const cleared = clearedLegacyPreferences(legacy, APPROVAL_CHOICE_KEYS);

    expect(cleared).toEqual({ ...pickLegacyPreferences(oldStore), toolApprovalOverrides: null });
    expect(hasLegacyValues(legacy, APPROVAL_CHOICE_KEYS)).toBe(true);
    expect(hasLegacyValues(cleared, APPROVAL_CHOICE_KEYS)).toBe(false);
    expect(hasLegacyValues(cleared)).toBe(true);
  });

  it("round-trips: a cleared store is still cleared when read back", () => {
    const cleared = clearedLegacyPreferences(pickLegacyPreferences(oldStore));
    expect(pickLegacyPreferences(cleared)).toEqual(cleared);
  });
});

describe("mergeLegacyPreferences", () => {
  it("takes the old fields of the first load", () => {
    expect(mergeLegacyPreferences({}, oldStore)).toEqual(pickLegacyPreferences(oldStore));
  });

  it("keeps a cleared field cleared when a stale window syncs the old value back", () => {
    const cleared = clearedLegacyPreferences(pickLegacyPreferences(oldStore));
    const merged = mergeLegacyPreferences(cleared, oldStore);
    expect(merged).toEqual(cleared);
    expect(hasLegacyValues(merged)).toBe(false);
  });
});

describe("hasLegacyValues", () => {
  it("is true while any old field holds a value, false is a value too", () => {
    expect(hasLegacyValues({ mcpEnabled: false })).toBe(true);
    expect(hasLegacyValues({})).toBe(false);
  });
});

describe("legacyOpenAISettings", () => {
  it("reads the settings the credential imports need", () => {
    expect(legacyOpenAISettings(pickLegacyPreferences(oldStore))).toEqual({
      openAIKey: "sk-old",
      openAIBaseUrl: "https://llm.example.com/v1",
      selectedModel: "gpt-5.4",
      modelNames: ["gpt-5.5"],
    });
  });

  it("is empty once the fields are cleared", () => {
    expect(legacyOpenAISettings(clearedLegacyPreferences(pickLegacyPreferences(oldStore)))).toEqual({
      openAIKey: "",
      openAIBaseUrl: "",
      selectedModel: "",
      modelNames: [],
    });
  });
});
