// The two agents of the chat, each one `ToolLoopAgent` of the AI SDK, built per
// run for the run's cluster and model:
//
// - the Freelens agent, with the Kubernetes tools of tools.ts, which act on the
//   cluster of their typed context;
// - the MCP agent, with the tools of the cluster's MCP servers, which takes the
//   place of the Freelens agent when MCP is enabled in the preferences.
//
// Both ask the user before a tool call that changes something runs: the AI SDK
// ends the run with an approval request instead of executing the call, and
// the next run, with the user's answer appended to the conversation, executes
// or denies it (see agent-service.ts and conversation.ts).

import { isStepCount, type LanguageModel, type ModelMessage, ToolLoopAgent, type ToolSet } from "ai";
import { stringify as stringifyYaml } from "yaml";
import { withCustomAgentRules } from "../provider/agent-rules-provider";
import { AGENT_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";
import { mergeApprovalRequests } from "./conversation";
import { describeToolCall } from "./tools/kubernetes-resource";
import { kubernetesToolApproval, kubernetesTools, kubernetesToolsContext } from "./tools/tools";

import type { ApprovalRequest } from "../../common/bridge/protocol";
import type { AgentStream } from "./agent-service";

// The most model calls of one run, tool calls included.
const MAX_STEPS = 20;

export type AgentKind = "freelens" | "mcp";

export interface ToolCallToApprove {
  toolName: string;
  input: unknown;
}

/** An agent as the agent service runs it. */
export interface ChatAgent {
  kind: AgentKind;
  // The tools the model may call; any other name is an unsupported tool.
  toolNames: ReadonlySet<string>;
  stream(options: {
    messages: ModelMessage[];
    signal: AbortSignal;
    onStepStart(messages: ModelMessage[]): void;
  }): Promise<AgentStream>;
  // The approval request the chat shows for the calls that wait on it.
  describeApprovals(toolCalls: readonly ToolCallToApprove[]): Promise<ApprovalRequest>;
}

const inputOf = (input: unknown): Record<string, unknown> =>
  typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};

/** The Freelens agent of a run on the given cluster. */
export const buildFreelensAgent = (model: LanguageModel, clusterId: string): ChatAgent => {
  const agent = new ToolLoopAgent({
    model,
    instructions: withCustomAgentRules(AGENT_PROMPT_TEMPLATE),
    tools: kubernetesTools,
    // The cluster travels as the typed context of every tool, never in module
    // state: two cluster frames run at once.
    toolsContext: kubernetesToolsContext(clusterId),
    toolApproval: kubernetesToolApproval(),
    stopWhen: isStepCount(MAX_STEPS),
  });
  return {
    kind: "freelens",
    toolNames: new Set(Object.keys(kubernetesTools)),
    stream: async ({ messages, signal, onStepStart }) =>
      (await agent.stream({
        messages,
        abortSignal: signal,
        onStepStart: (event) => onStepStart(event.messages),
      })) as unknown as AgentStream,
    // The current YAML of the objects a write changes is loaded here, when the
    // request is built, and shown as a backup.
    describeApprovals: async (toolCalls) =>
      mergeApprovalRequests(
        await Promise.all(
          toolCalls.map(({ toolName, input }) => describeToolCall(toolName, inputOf(input), clusterId)),
        ),
      ),
  };
};

/** The MCP agent of a run, with the tools of the cluster's MCP servers. */
export const buildMcpAgent = (model: LanguageModel, tools: ToolSet): ChatAgent => {
  const agent = new ToolLoopAgent({
    model,
    // The MCP agent has no instructions of its own: the servers describe their
    // tools.
    tools,
    // Every MCP tool call waits on the user's approval.
    toolApproval: () => "user-approval",
    stopWhen: isStepCount(MAX_STEPS),
  });
  return {
    kind: "mcp",
    toolNames: new Set(Object.keys(tools)),
    stream: async ({ messages, signal, onStepStart }) =>
      (await agent.stream({
        messages,
        abortSignal: signal,
        onStepStart: (event) => onStepStart(event.messages),
      })) as unknown as AgentStream,
    describeApprovals: async (toolCalls) => {
      const toolNames = toolCalls.map(({ toolName }) => toolName);
      return {
        question: "The agent has requested to use a tool",
        options: ["yes", "no"],
        actionToApprove: { action: toolNames },
        actionString: stringifyYaml(toolCalls.map(({ toolName, input }) => ({ tool: toolName, input }))),
        requestString: "The agent wants to use this tool: " + toolNames.join(", "),
      };
    },
  };
};
