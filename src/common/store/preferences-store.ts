import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { type CustomModel, DEFAULT_MODELS, DEFAULT_OPENAI_BASE_URL } from "../../renderer/business/provider/ai-models";
import { resolveSelectedModel } from "../../renderer/business/provider/model-list";
import { DEFAULT_CHAT_RETENTION_DAYS } from "../agent-protocol";
import { loadApprovalOverrides, type ToolApprovalOverrides } from "../agent-tools/approval-settings";
import { DEFAULT_THINKING_LEVEL, loadThinkingLevel, type ThinkingLevel } from "../thinking-level";

import type { MessageObject } from "../../renderer/business/objects/message-object";

const DEFAULT_SELECTED_MODEL = DEFAULT_MODELS[0]?.name ?? "";

/** A whole number of days, 0 or more; anything else falls back to the default. */
export const parseRetentionDays = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : DEFAULT_CHAT_RETENTION_DAYS;

export interface PreferencesModel {
  openAIKey: string;
  openAIBaseUrl: string;
  /** Read once to import into `thinkingLevel`; no longer used. */
  openAIReasoningEffort: string;
  /** Read once to import into `thinkingLevel`; no longer used. */
  disableThinking: boolean;
  aiProxyPort: number | null;
  aiProxyToken: string | null;
  selectedModel: string;
  models: CustomModel[];
  mcpEnabled: boolean;
  mcpConfiguration: string;
  /** Read once to import the old pod logs setting into `toolApprovalOverrides`; no longer written. */
  podLogsRequireApproval?: boolean;
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
  openAIKey: string = "";
  openAIBaseUrl: string = DEFAULT_OPENAI_BASE_URL;
  openAIReasoningEffort: string = "";
  disableThinking: boolean = false;
  aiProxyPort: number | null = null;
  // Per-launch shared secret required on every request to the local AI proxy.
  // Generated in the main process on activation and synced to the renderer via
  // this store; blocks other local processes that learn the port from using it.
  aiProxyToken: string | null = null;
  selectedModel: string = DEFAULT_SELECTED_MODEL;
  models: CustomModel[] = [...DEFAULT_MODELS];
  mcpEnabled: boolean = false;
  mcpConfiguration: string = "";
  // The user's "Requires approval" choices, only for tools that differ from
  // their default. Main reads it before every tool call.
  toolApprovalOverrides: ToolApprovalOverrides = {};
  // Default number of tail lines fetched when reading pod logs.
  podLogsTailLines: number = DEFAULT_POD_LOGS_TAIL_LINES;
  // User-provided extra agent rules appended to every agent's system message.
  customAgentRules: string = "";
  // The pi model the chat runs on, as "provider/id". Empty until one is chosen
  // or imported from the old OpenAI settings.
  agentModel: string = "";
  // Main deletes chats not changed for longer than this many days; 0 keeps them.
  chatRetentionDays: number = DEFAULT_CHAT_RETENTION_DAYS;
  // The global thinking level; main reads it before every prompt and pi clamps
  // it to the model. AI Explain maps it to its reasoning effort.
  thinkingLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL;

  // Not persistent
  explainEvent: MessageObject = {} as MessageObject;
  // Not persistent: when enabled, the agent auto-approves tool-use requests
  bypassApprovals: boolean = false;

  constructor() {
    super({
      configName: "freelens-ai-preferences-store",
      defaults: {
        openAIKey: "",
        openAIBaseUrl: DEFAULT_OPENAI_BASE_URL,
        openAIReasoningEffort: "",
        disableThinking: false,
        aiProxyPort: null,
        aiProxyToken: null,
        selectedModel: DEFAULT_SELECTED_MODEL,
        models: [...DEFAULT_MODELS],
        mcpEnabled: false,
        // No `toolApprovalOverrides` default: a missing field means the old
        // pod logs setting has not been imported yet.
        podLogsTailLines: DEFAULT_POD_LOGS_TAIL_LINES,
        customAgentRules: "",
        agentModel: "",
        chatRetentionDays: DEFAULT_CHAT_RETENTION_DAYS,
        // No `thinkingLevel` default: a missing field means the old reasoning
        // settings have not been imported yet.
        mcpConfiguration: JSON.stringify(
          {
            mcpServers: {
              kubernetes: {
                command: "npx",
                args: ["mcp-server-kubernetes"],
              },
            },
          },
          null,
          2,
        ),
      },
    });
    // Use the explicit annotation form instead of `@observable` decorators.
    // The build's legacy decorator transform emits native class-field
    // initializers, which the decorators cannot convert into observables; the
    // explicit form reads the initialized field values directly and works
    // regardless of how the build emits class fields.
    makeObservable(this, {
      openAIKey: observable,
      openAIBaseUrl: observable,
      openAIReasoningEffort: observable,
      disableThinking: observable,
      aiProxyPort: observable,
      aiProxyToken: observable,
      selectedModel: observable,
      models: observable,
      mcpEnabled: observable,
      mcpConfiguration: observable,
      toolApprovalOverrides: observable.ref,
      podLogsTailLines: observable,
      customAgentRules: observable,
      agentModel: observable,
      chatRetentionDays: observable,
      thinkingLevel: observable,
      explainEvent: observable,
      bypassApprovals: observable,
    });
  }

  async updateMcpConfiguration(newMcpConfiguration: string) {
    this.mcpConfiguration = newMcpConfiguration;
  }

  fromStore(preferencesModel: PreferencesModel): void {
    this.openAIKey = preferencesModel.openAIKey;
    this.openAIBaseUrl = preferencesModel.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;
    this.openAIReasoningEffort = preferencesModel.openAIReasoningEffort ?? "";
    this.disableThinking = preferencesModel.disableThinking ?? false;
    this.aiProxyPort = preferencesModel.aiProxyPort ?? null;
    this.aiProxyToken = preferencesModel.aiProxyToken ?? null;
    this.models = preferencesModel.models?.length ? preferencesModel.models : [...DEFAULT_MODELS];
    // Validate the selection against the available models; fall back to the
    // first entry (replaces the old enum validation).
    this.selectedModel = resolveSelectedModel(this.models, preferencesModel.selectedModel);
    this.mcpEnabled = preferencesModel.mcpEnabled;
    this.mcpConfiguration = preferencesModel.mcpConfiguration;
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
    // `models` is an observable array; the host persists this value by sending
    // it over IPC, which structure-clones it. A live MobX proxy cannot be
    // cloned ("An object could not be cloned"), so convert it to a plain array.
    // `toJS` must be applied to the observable itself: it is a no-op on a plain
    // wrapper object and does not recurse into non-observables.
    return {
      openAIKey: this.openAIKey,
      openAIBaseUrl: this.openAIBaseUrl,
      openAIReasoningEffort: this.openAIReasoningEffort,
      disableThinking: this.disableThinking,
      aiProxyPort: this.aiProxyPort,
      aiProxyToken: this.aiProxyToken,
      selectedModel: this.selectedModel,
      models: toJS(this.models),
      mcpEnabled: this.mcpEnabled,
      mcpConfiguration: this.mcpConfiguration,
      toolApprovalOverrides: this.toolApprovalOverrides,
      podLogsTailLines: this.podLogsTailLines,
      customAgentRules: this.customAgentRules,
      agentModel: this.agentModel,
      chatRetentionDays: this.chatRetentionDays,
      thinkingLevel: this.thinkingLevel,
    };
  }
}
