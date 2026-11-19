// The agents of every cluster, as the bridge serves them. One runtime lives from
// `onActivate` to `onDeactivate`; a reload builds a new one.
//
// An agent is built for every run, for the run's cluster and the model of the
// preferences, so a change of the preferences applies to the next run. What
// lasts between runs is the conversation, stored per cluster, agent and
// conversation in `AgentStateStore`, and the MCP servers of each cluster.

import { Main } from "@freelensapp/extensions";
import { compareStructural, reaction } from "mobx";
import { checkpointNamespace } from "../../common/agent/checkpoint-namespace";
import { BridgeErrorCode } from "../../common/bridge/protocol";
import { DEFAULT_OPENAI_BASE_URL } from "../../common/provider/ai-models";
import { approximateTokenCount } from "../../common/provider/token-estimate";
import { AgentStateStore, PreferencesStore } from "../../common/store";
import { BridgeRequestError } from "../bridge/bridge-error";
import { McpClients } from "../mcp/mcp-clients";
import { useModelProvider } from "../provider/model-provider";
import useLog from "../utils/logger";
import { runAgent } from "./agent-service";
import { type AgentKind, buildFreelensAgent, buildMcpAgent, type ChatAgent } from "./agents";
import { useAiAnalysisService } from "./ai-analysis-service";
import {
  answerApprovals,
  closePendingApprovals,
  findPendingApprovals,
  promptMessages,
  toHistoryMessages,
  trimHistory,
} from "./conversation";
import { describeAgentError } from "./describe-error";
import { useSessionCompactionService } from "./session-compaction-service";
import { toolFunctionDescriptions } from "./tools/tools";

import type { LanguageModel, ModelMessage } from "ai";

import type {
  AgentRunRequest,
  CompactResponse,
  ConversationRequest,
  ExplainRequest,
  ToolDescription,
} from "../../common/bridge/protocol";
import type { StoredAgentMessage } from "../../common/store/agent-state-store";

export class AgentRuntime {
  private readonly log = useLog("AgentRuntime").log;
  private readonly preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  private readonly disposers: (() => void)[];

  constructor(
    private readonly mcpClients: McpClients = new McpClients(),
    // The model of the preferences, read for every request; a test passes a
    // mock model.
    private readonly getModel: () => LanguageModel = () => useModelProvider().getModel(),
  ) {
    this.disposers = [
      // Turning MCP off or changing its configuration stops every server; the
      // next request starts the new configuration's servers once.
      reaction(
        () => [this.preferencesStore.mcpEnabled, this.preferencesStore.mcpConfiguration],
        () => void this.mcpClients.closeAll(),
        { equals: compareStructural },
      ),
      // A disconnect removes the files of the cluster's environment, so the
      // servers started with it stop; they start again on the next request.
      reaction(
        () => Main.Catalog.getAllClusters().map(({ id, status }) => `${id}=${status}`),
        () => void this.mcpClients.closeDisconnected(),
        { equals: compareStructural },
      ),
    ];
  }

  /** Stops the MCP servers and the reactions; called from `onDeactivate`. */
  async dispose(): Promise<void> {
    for (const dispose of this.disposers) {
      dispose();
    }
    await this.mcpClients.closeAll();
  }

  private get store() {
    return AgentStateStore.getInstanceOrCreate<AgentStateStore>();
  }

  private get activeKind(): AgentKind {
    return this.preferencesStore.mcpEnabled ? "mcp" : "freelens";
  }

  private loadConversation(clusterId: string, kind: AgentKind, conversationId: string): ModelMessage[] {
    return this.store.getConversation(
      checkpointNamespace(clusterId, kind),
      conversationId,
    ) as unknown as ModelMessage[];
  }

  private saveConversation(clusterId: string, kind: AgentKind, conversationId: string, messages: ModelMessage[]) {
    this.store.setConversation(
      checkpointNamespace(clusterId, kind),
      conversationId,
      messages as unknown as StoredAgentMessage[],
    );
  }

  private async buildAgent(clusterId: string, kind: AgentKind): Promise<ChatAgent> {
    if (kind === "mcp") {
      // The tools call the servers that are running now; the servers keep
      // running for the next run of the cluster.
      const tools = await this.mcpClients.getTools(clusterId, this.preferencesStore.mcpConfiguration);
      return buildMcpAgent(this.getModel(), tools);
    }
    return buildFreelensAgent(this.getModel(), clusterId);
  }

  private describeError(error: unknown) {
    return new Error(describeAgentError(error, this.preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL));
  }

  async *run({ clusterId, conversationId, input }: AgentRunRequest, signal: AbortSignal) {
    try {
      const kind = this.activeKind;
      const stored = this.loadConversation(clusterId, kind, conversationId);
      let messages: ModelMessage[];
      if (input.kind === "resume") {
        // A pending approval is read from the stored messages, so it survives
        // a restart. A clear removes them, and with them the approval.
        const pending = findPendingApprovals(stored);
        if (pending.length === 0) {
          throw new BridgeRequestError("There is no pending approval to answer.", BridgeErrorCode.noPendingApproval);
        }
        messages = answerApprovals(stored, pending, input.answer === "yes");
      } else {
        messages = trimHistory([...closePendingApprovals(stored), ...promptMessages(input)]);
      }
      const agent = await this.buildAgent(clusterId, kind);
      yield* runAgent({
        agent,
        messages,
        signal,
        save: (conversation) => this.saveConversation(clusterId, kind, conversationId, conversation),
      });
    } catch (error) {
      if (error instanceof BridgeRequestError) {
        this.log.warn(error.message, { clusterId, conversationId });
        throw error;
      }
      this.log.error("Error while running the agent: ", error);
      throw this.describeError(error);
    }
  }

  async *explain({ text }: ExplainRequest, signal: AbortSignal) {
    try {
      for await (const chunk of useAiAnalysisService(this.getModel).analyze(text, signal)) {
        yield { type: "text" as const, text: chunk };
      }
    } catch (error) {
      this.log.error("Error in AI analysis: ", error);
      throw this.describeError(error);
    }
  }

  // Summarizes the stored conversation, replaces it with nothing, and returns
  // the summary to seed into the next prompt. On any failure the conversation
  // is still replaced (best effort) so the next prompt cannot exceed the limit;
  // only the summary context is lost.
  async compact({ clusterId, conversationId }: ConversationRequest): Promise<CompactResponse> {
    const kind = this.activeKind;
    try {
      const messages = this.loadConversation(clusterId, kind, conversationId);
      const summary = await useSessionCompactionService(this.getModel).summarize(toHistoryMessages(messages));
      this.saveConversation(clusterId, kind, conversationId, []);
      return { summary: summary.length > 0 ? summary : null, contextTokens: approximateTokenCount(summary) };
    } catch (error) {
      this.log.error("Failed to compact session: ", error);
      this.saveConversation(clusterId, kind, conversationId, []);
      return { summary: null, contextTokens: 0 };
    }
  }

  // Wipes the conversations of both agents of the cluster, so a restart right
  // after a clear does not restore the model-side context. Other clusters'
  // memory is left untouched.
  async clear({ clusterId }: ConversationRequest): Promise<Record<string, never>> {
    this.store.clearForCluster(clusterId);
    return {};
  }

  async tools(clusterId: string): Promise<ToolDescription[]> {
    if (this.preferencesStore.mcpEnabled) {
      const tools = await this.mcpClients.getTools(clusterId, this.preferencesStore.mcpConfiguration);
      return Object.entries(tools).map(([name, { description }]) => ({
        name,
        description: typeof description === "string" ? description : "",
      }));
    }
    return toolFunctionDescriptions.map(({ name, description }) => ({ name, description }));
  }
}
