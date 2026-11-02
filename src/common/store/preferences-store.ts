import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, observableRef } from "mobx";
import { DEFAULT_CHAT_RETENTION_DAYS } from "../agent-protocol";
import { STANDARD_PROFILE } from "../invocation-policy/shipped-profiles";
import { DEFAULT_THINKING_LEVEL, loadThinkingLevel, type ThinkingLevel } from "../thinking-level";
import {
  clearedLegacyPreferences,
  hasLegacyValues,
  LEGACY_PREFERENCE_KEYS,
  type LegacyPreferenceKey,
  type LegacyPreferences,
  mergeLegacyPreferences,
} from "./legacy-preferences";
import { loadDefaultProfileId, loadProfileAssignments, loadUserProfiles } from "./policy-profile-preferences";

import type { PolicyProfile } from "../invocation-policy/policy-profile";
import type { PolicyProfileSettings } from "../invocation-policy/profile-assignment";
import type { MessageObject } from "../objects/message-object";

/** A whole number of days, 0 or more; anything else falls back to the default. */
export const parseRetentionDays = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : DEFAULT_CHAT_RETENTION_DAYS;

export interface PreferencesModel extends LegacyPreferences {
  userProfiles: PolicyProfile[];
  profileAssignments: Record<string, string>;
  defaultProfileId: string;
  podLogsTailLines: number;
  customAgentRules: string;
  agentModel: string;
  chatRetentionDays: number;
  /** Absent until the old reasoning-effort settings have been imported. */
  thinkingLevel?: ThinkingLevel;
}

export const DEFAULT_POD_LOGS_TAIL_LINES = 1000;

export class PreferencesStore extends Common.Store.ExtensionStore<PreferencesModel> implements PolicyProfileSettings {
  // Persistent
  // The policy profiles the user created or duplicated; the shipped ones live
  // in code. Main reads them, the assignments and the default profile before
  // every kubectl call, and checks the pending approvals again when any of
  // them is replaced.
  userProfiles: PolicyProfile[] = [];
  // The profile id of each cluster with an assignment, by cluster id.
  profileAssignments: Record<string, string> = {};
  // The profile of every cluster without an assignment, or assigned to a
  // profile that no longer exists.
  defaultProfileId: string = STANDARD_PROFILE.id;
  // Default number of tail lines fetched when reading pod logs.
  podLogsTailLines: number = DEFAULT_POD_LOGS_TAIL_LINES;
  // User-provided extra rules, sent with every prompt and AI Explain.
  customAgentRules: string = "";
  // The pi model the chat runs on, as "provider/id". Empty until one is chosen
  // or imported from the old OpenAI settings.
  agentModel: string = "";
  // Main deletes chats not changed for longer than this many days; 0 keeps them.
  chatRetentionDays: number = DEFAULT_CHAT_RETENTION_DAYS;
  // The global thinking level; main reads it before every prompt and pi clamps
  // it to the model.
  thinkingLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL;
  // The old LangChain fields and per-tool approval choices as found in the
  // file, saved back unchanged until main has imported them and calls
  // clearLegacy.
  legacy: LegacyPreferences = {};

  // Not persistent
  explainEvent: MessageObject = {} as MessageObject;

  constructor() {
    super({
      configName: "freelens-ai-preferences-store",
      defaults: {
        userProfiles: [],
        profileAssignments: {},
        defaultProfileId: STANDARD_PROFILE.id,
        podLogsTailLines: DEFAULT_POD_LOGS_TAIL_LINES,
        customAgentRules: "",
        agentModel: "",
        chatRetentionDays: DEFAULT_CHAT_RETENTION_DAYS,
        // No `thinkingLevel` default: a missing field means the old reasoning
        // settings have not been imported yet.
      },
    });
    // The annotation map on plain fields rather than `@observable accessor`
    // fields: `makeObservable` runs after the field initializers, the fields stay
    // own properties of the instance, and `toJSON()`, which the host persists,
    // reads them as they are. Accessor fields would keep the values behind
    // getters on the prototype, which `toJS()` and spreading do not see.
    makeObservable(this, {
      userProfiles: observableRef,
      profileAssignments: observableRef,
      defaultProfileId: observable,
      podLogsTailLines: observable,
      customAgentRules: observable,
      agentModel: observable,
      chatRetentionDays: observable,
      thinkingLevel: observable,
      legacy: observableRef,
      explainEvent: observable,
    });
  }

  /**
   * Overwrites the old fields with `null` in the file, so the old plain-text
   * OpenAI key does not stay on disk. Main calls it once an import is done, with
   * the fields of that import, and once the imports of pi are done, for every
   * field.
   */
  clearLegacy(keys: readonly LegacyPreferenceKey[] = LEGACY_PREFERENCE_KEYS): void {
    if (hasLegacyValues(this.legacy, keys)) {
      this.legacy = clearedLegacyPreferences(this.legacy, keys);
    }
  }

  fromStore(preferencesModel: PreferencesModel): void {
    this.legacy = mergeLegacyPreferences(this.legacy, preferencesModel);
    this.userProfiles = loadUserProfiles(preferencesModel.userProfiles);
    this.profileAssignments = loadProfileAssignments(preferencesModel.profileAssignments);
    this.defaultProfileId = loadDefaultProfileId(preferencesModel.defaultProfileId);
    this.podLogsTailLines =
      typeof preferencesModel.podLogsTailLines === "number" && preferencesModel.podLogsTailLines > 0
        ? preferencesModel.podLogsTailLines
        : DEFAULT_POD_LOGS_TAIL_LINES;
    this.customAgentRules = preferencesModel.customAgentRules ?? "";
    this.agentModel = preferencesModel.agentModel ?? "";
    this.chatRetentionDays = parseRetentionDays(preferencesModel.chatRetentionDays);
    this.thinkingLevel = loadThinkingLevel(preferencesModel);
  }

  toJSON(): PreferencesModel {
    // Every value is plain: the host persists this by sending it over IPC,
    // which structure-clones it, and a live MobX proxy cannot be cloned.
    return {
      ...this.legacy,
      userProfiles: this.userProfiles,
      profileAssignments: this.profileAssignments,
      defaultProfileId: this.defaultProfileId,
      podLogsTailLines: this.podLogsTailLines,
      customAgentRules: this.customAgentRules,
      agentModel: this.agentModel,
      chatRetentionDays: this.chatRetentionDays,
      thinkingLevel: this.thinkingLevel,
    };
  }
}
