import { Common } from "@freelensapp/extensions";
import { makeObservable, observable } from "mobx";
import { DEFAULT_CHAT_RETENTION_DAYS } from "../agent-protocol";
import { loadApprovalOverrides, type ToolApprovalOverrides } from "../agent-tools/approval-settings";
import { DEFAULT_THINKING_LEVEL, loadThinkingLevel, type ThinkingLevel } from "../thinking-level";
import {
  clearedLegacyPreferences,
  hasLegacyValues,
  type LegacyPreferences,
  mergeLegacyPreferences,
} from "./legacy-preferences";

import type { MessageObject } from "../objects/message-object";

/** A whole number of days, 0 or more; anything else falls back to the default. */
export const parseRetentionDays = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : DEFAULT_CHAT_RETENTION_DAYS;

export interface PreferencesModel extends LegacyPreferences {
  /** Absent until the old pod logs setting has been imported. */
  toolApprovalOverrides?: ToolApprovalOverrides;
  podLogsTailLines: number;
  customAgentRules: string;
  agentModel: string;
  chatRetentionDays: number;
  /** Absent until the old reasoning-effort settings have been imported. */
  thinkingLevel?: ThinkingLevel;
}

export const DEFAULT_POD_LOGS_TAIL_LINES = 1000;

export class PreferencesStore extends Common.Store.ExtensionStore<PreferencesModel> {
  // Persistent
  // The user's "Requires approval" choices, only for tools that differ from
  // their default. Main reads it before every tool call.
  toolApprovalOverrides: ToolApprovalOverrides = {};
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
  // The old LangChain fields as found in the file, saved back unchanged until
  // main has imported them into pi and calls clearLegacy.
  legacy: LegacyPreferences = {};

  // Not persistent
  explainEvent: MessageObject = {} as MessageObject;

  constructor() {
    super({
      configName: "freelens-ai-preferences-store",
      defaults: {
        // No `toolApprovalOverrides` default: a missing field means the old
        // pod logs setting has not been imported yet.
        podLogsTailLines: DEFAULT_POD_LOGS_TAIL_LINES,
        customAgentRules: "",
        agentModel: "",
        chatRetentionDays: DEFAULT_CHAT_RETENTION_DAYS,
        // No `thinkingLevel` default: a missing field means the old reasoning
        // settings have not been imported yet.
      },
    });
    // Use the explicit annotation form instead of `@observable` decorators.
    // The build's legacy decorator transform emits native class-field
    // initializers, which the decorators cannot convert into observables; the
    // explicit form reads the initialized field values directly and works
    // regardless of how the build emits class fields.
    makeObservable(this, {
      toolApprovalOverrides: observable.ref,
      podLogsTailLines: observable,
      customAgentRules: observable,
      agentModel: observable,
      chatRetentionDays: observable,
      thinkingLevel: observable,
      legacy: observable.ref,
      explainEvent: observable,
    });
  }

  /**
   * Overwrites the old fields with `null` in the file, so the old plain-text
   * OpenAI key does not stay on disk. Main calls it once the imports are done.
   */
  clearLegacy(): void {
    if (hasLegacyValues(this.legacy)) {
      this.legacy = clearedLegacyPreferences(this.legacy);
    }
  }

  fromStore(preferencesModel: PreferencesModel): void {
    this.legacy = mergeLegacyPreferences(this.legacy, preferencesModel);
    this.toolApprovalOverrides = loadApprovalOverrides(preferencesModel);
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
      toolApprovalOverrides: this.toolApprovalOverrides,
      podLogsTailLines: this.podLogsTailLines,
      customAgentRules: this.customAgentRules,
      agentModel: this.agentModel,
      chatRetentionDays: this.chatRetentionDays,
      thinkingLevel: this.thinkingLevel,
    };
  }
}
