// The agents of every cluster, as the bridge serves them. One runtime lives from
// `onActivate` to `onDeactivate`; a reload builds a new one.

import { RemoveMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { DEFAULT_OPENAI_BASE_URL } from "../../common/provider/ai-models";
import { approximateTokenCount } from "../../common/provider/token-estimate";
import { AgentStateStore, PreferencesStore } from "../../common/store";
import useLog from "../utils/logger";
import { type AgentServiceEvent, useAgentService } from "./agent-service";
import { useAiAnalysisService } from "./ai-analysis-service";
import { describeAgentError } from "./describe-error";
import { type FreeLensAgent, useFreeLensAgentSystem } from "./freelens-agent-system";
import { type MPCAgent, useMcpAgent } from "./mcp-agent";
import { useSessionCompactionService } from "./session-compaction-service";

import type {
  AgentRunInput,
  AgentRunRequest,
  CompactResponse,
  ConversationRequest,
  ExplainRequest,
  ToolDescription,
} from "../../common/bridge/protocol";

type Agent = FreeLensAgent | MPCAgent;

const buildAgentInput = (input: AgentRunInput) => {
  if (input.kind === "resume") {
    return new Command({ resume: input.answer });
  }
  // When the session was just compacted, prepend the summary so the agent keeps
  // the earlier context even though the model-side history was wiped.
  return {
    messages: input.summary
      ? [
          { role: "user", content: `Summary of the earlier (compacted) conversation:\n${input.summary}` },
          { role: "user", content: input.text },
        ]
      : [{ role: "user", content: input.text }],
  };
};

export class AgentRuntime {
  private readonly log = useLog("AgentRuntime").log;
  private readonly preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  private readonly freeLensAgentSystem = useFreeLensAgentSystem();
  private readonly freeLensAgents = new Map<string, FreeLensAgent>();
  // Rebuilt when the MCP configuration changes.
  private readonly mcpAgents = new Map<string, { configuration: string; agent: MPCAgent }>();

  private getFreeLensAgent(clusterId: string): FreeLensAgent {
    let agent = this.freeLensAgents.get(clusterId);
    if (!agent) {
      agent = this.freeLensAgentSystem.buildAgentSystem(clusterId);
      this.freeLensAgents.set(clusterId, agent);
    }
    return agent;
  }

  private async getMcpAgent(clusterId: string): Promise<MPCAgent> {
    const configuration = this.preferencesStore.mcpConfiguration;
    const cached = this.mcpAgents.get(clusterId);
    if (cached && cached.configuration === configuration) {
      return cached.agent;
    }
    const agent = await useMcpAgent(configuration).buildAgentSystem(clusterId);
    this.mcpAgents.set(clusterId, { configuration, agent });
    return agent;
  }

  private getActiveAgent(clusterId: string): Promise<Agent> | Agent {
    return this.preferencesStore.mcpEnabled ? this.getMcpAgent(clusterId) : this.getFreeLensAgent(clusterId);
  }

  private describeError(error: unknown) {
    return new Error(describeAgentError(error, this.preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL));
  }

  private async cleanMessageHistory(agent: Agent, conversationId: string) {
    const config = { configurable: { thread_id: conversationId } };
    const messages = (await agent.getState(config)).values.messages;
    if (!messages || messages.length === 0) {
      return;
    }
    for (const message of messages) {
      await agent.updateState(config, { messages: new RemoveMessage({ id: message.id }) });
    }
  }

  async *run({ clusterId, conversationId, input }: AgentRunRequest, signal: AbortSignal) {
    try {
      const agent = await this.getActiveAgent(clusterId);
      const events: AsyncGenerator<AgentServiceEvent> = useAgentService(agent).run(buildAgentInput(input), {
        clusterId,
        conversationId,
        signal,
      });
      yield* events;
    } catch (error) {
      this.log.error("Error while running the agent: ", error);
      throw this.describeError(error);
    }
  }

  async *explain({ text }: ExplainRequest, signal: AbortSignal) {
    try {
      for await (const chunk of useAiAnalysisService().analyze(text, signal)) {
        yield { type: "text" as const, text: chunk };
      }
    } catch (error) {
      this.log.error("Error in AI analysis: ", error);
      throw this.describeError(error);
    }
  }

  // Summarizes the model-side history, wipes it, and returns the summary to seed
  // into the next prompt. On any failure the history is still wiped (best
  // effort) so the next prompt cannot exceed the limit; only the summary
  // context is lost.
  async compact({ clusterId, conversationId }: ConversationRequest): Promise<CompactResponse> {
    const agent = await this.getActiveAgent(clusterId);
    const config = { configurable: { thread_id: conversationId } };

    try {
      const messages = (await agent.getState(config)).values.messages ?? [];
      const summary = await useSessionCompactionService().summarize(messages);
      await this.cleanMessageHistory(agent, conversationId);
      return { summary: summary.length > 0 ? summary : null, contextTokens: approximateTokenCount(summary) };
    } catch (error) {
      this.log.error("Failed to compact session: ", error);
      try {
        await this.cleanMessageHistory(agent, conversationId);
      } catch (cleanError) {
        this.log.error("Failed to clean history during compaction fallback: ", cleanError);
      }
      return { summary: null, contextTokens: 0 };
    }
  }

  // Wipes the conversation of both agents of the cluster, and the cluster's
  // durable checkpointer state, so a restart right after a clear does not
  // restore the model-side context. Other clusters' memory is left untouched.
  async clear({ clusterId, conversationId }: ConversationRequest): Promise<Record<string, never>> {
    const agents: Agent[] = [];
    const freeLensAgent = this.freeLensAgents.get(clusterId);
    if (freeLensAgent) {
      agents.push(freeLensAgent);
    }
    const mcpAgent = this.mcpAgents.get(clusterId)?.agent;
    if (mcpAgent) {
      agents.push(mcpAgent);
    }
    for (const agent of agents) {
      try {
        await this.cleanMessageHistory(agent, conversationId);
      } catch (error) {
        this.log.error("Failed to clean the agent message history: ", error);
      }
    }
    AgentStateStore.getInstanceOrCreate<AgentStateStore>().clearForCluster(clusterId);
    return {};
  }

  async tools(): Promise<ToolDescription[]> {
    if (this.preferencesStore.mcpEnabled) {
      const tools = await useMcpAgent(this.preferencesStore.mcpConfiguration).loadMcpTools();
      return tools.map(({ name, description }) => ({ name, description }));
    }
    return this.freeLensAgentSystem.availableTools.map(({ name, description }) => ({ name, description }));
  }
}
