// Store-aware provider of the single Freelens agent for the current cluster
// frame. The agent is created once per (cluster, conversation, MCP
// configuration) and reused across prompts, so its in-memory history and
// pending approvals stay live between runs; the session manager mirrors them to
// the host-persisted `AgentStateStore` so they also survive a restart.

import { PreferencesStore } from "../../../common/store";
import { AgentStateStore } from "../../../common/store/agent-state-store";
import { withCustomAgentRules } from "../provider/agent-rules-provider";
import { useModelProvider } from "../provider/model-provider";
import { FREELENS_AGENT_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";
import { createFreelensAgent, resetConversation } from "./freelens-agent";
import { connectMcpServers, disconnectMcpServers, type McpConnection } from "./mcp-servers";
import { KeyValueSessionStorage, sessionIdFor } from "./session-storage";
import { allToolFunctions, toolFunctionDescriptions } from "./tools/tools";

import type { Agent } from "@strands-agents/sdk";

interface CachedAgent {
  key: string;
  agent: Agent;
}

interface CachedMcpConnection {
  configuration: string;
  connection: Promise<McpConnection>;
}

let cachedAgent: CachedAgent | null = null;
let cachedMcp: CachedMcpConnection | null = null;

const getPreferencesStore = () => PreferencesStore.getInstanceOrCreate<PreferencesStore>();

// The MCP configuration in effect: empty when MCP is disabled.
const activeMcpConfiguration = (): string => {
  const preferencesStore = getPreferencesStore();
  return preferencesStore.mcpEnabled ? preferencesStore.mcpConfiguration : "";
};

// Connect the configured MCP servers once per configuration, closing the
// previous connection when the configuration changes.
const getMcpConnection = (configuration: string): Promise<McpConnection> => {
  if (cachedMcp?.configuration === configuration) {
    return cachedMcp.connection;
  }
  const previous = cachedMcp;
  const connection = connectMcpServers(configuration);
  cachedMcp = { configuration, connection };
  // A failed connection is not cached, so the next prompt retries it.
  connection.catch(() => {
    if (cachedMcp?.connection === connection) {
      cachedMcp = null;
    }
  });
  previous?.connection.then(disconnectMcpServers).catch(() => undefined);
  return connection;
};

/**
 * The agent for the given cluster and conversation, with the built-in
 * Kubernetes tools and, when MCP is enabled, the MCP server tools.
 */
export const getFreelensAgent = async (clusterId: string, conversationId: string): Promise<Agent> => {
  const mcpConfiguration = activeMcpConfiguration();
  const key = JSON.stringify([clusterId, conversationId, mcpConfiguration]);
  const systemPrompt = withCustomAgentRules(FREELENS_AGENT_PROMPT_TEMPLATE);

  if (cachedAgent?.key === key) {
    // Pick up custom agent rules edited since the agent was created.
    cachedAgent.agent.systemPrompt = systemPrompt;
    return cachedAgent.agent;
  }

  const { tools: mcpTools } = await getMcpConnection(mcpConfiguration);
  console.log("Creating the Freelens agent, MCP tools: ", mcpTools.length);
  const agent = createFreelensAgent({
    // Replaced per run by the agent service; set here because the agent needs a
    // concrete model from the start.
    model: useModelProvider().getModel(),
    systemPrompt,
    tools: allToolFunctions,
    mcpTools,
    storage: new KeyValueSessionStorage(AgentStateStore.getInstanceOrCreate<AgentStateStore>()),
    sessionId: sessionIdFor(clusterId, conversationId),
  });
  // Restores the persisted conversation and pending approvals, if any.
  await agent.initialize();
  cachedAgent = { key, agent };
  return agent;
};

/**
 * The agent history, for compaction. Empty when no agent was created yet.
 */
export const getFreelensAgentIfCreated = (): Agent | null => cachedAgent?.agent ?? null;

/**
 * Forget the current conversation of the cached agent (if any) and wipe this
 * cluster's persisted sessions, so a restart right after a clear does not
 * restore the conversation. Other clusters' sessions are left untouched.
 */
export const clearFreelensAgentConversation = async (clusterId: string): Promise<void> => {
  if (cachedAgent) {
    await resetConversation(cachedAgent.agent);
  }
  AgentStateStore.getInstanceOrCreate<AgentStateStore>().clearForCluster(clusterId);
};

/**
 * Name and description of every tool the agent can use, for the tools list.
 */
export const getAvailableTools = async (): Promise<{ name: string; description: string }[]> => {
  const mcpConfiguration = activeMcpConfiguration();
  const builtinTools = toolFunctionDescriptions.map(({ name, description }) => ({ name, description }));
  if (mcpConfiguration === "") {
    return builtinTools;
  }
  const { tools: mcpTools } = await getMcpConnection(mcpConfiguration);
  return [...builtinTools, ...mcpTools.map(({ name, description }) => ({ name, description }))];
};
