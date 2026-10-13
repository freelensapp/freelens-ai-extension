import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { Command, interrupt, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { checkpointNamespace } from "../../common/agent/checkpoint-namespace";
import { useModelProvider } from "../provider/model-provider";
import useLog from "../utils/logger";
import { teardownNode } from "./nodes/teardown";
import { PersistentMemorySaver } from "./persistent-memory-saver";
import { GraphState } from "./state/graph-state";

import type { StructuredToolInterface } from "@langchain/core/tools";

export type MPCAgent = Awaited<ReturnType<ReturnType<typeof useMcpAgent>["buildAgentSystem"]>>;

export const useMcpAgent = (mcpConfiguration: string) => {
  const { log } = useLog("useMcpAgent");

  // The MCP client spawns stdio servers as child processes, which the renderer
  // cannot do, so it runs in main with the agents (#295). Until then the MCP
  // agent has no tools and fails to start, as with an invalid configuration.
  const loadMcpTools = async (): Promise<StructuredToolInterface[]> => {
    log.debug("MCP configuration: ", mcpConfiguration);
    throw new Error("MCP servers are not available in the renderer; they move to the main process.");
  };

  const buildAgentSystem = async (clusterId: string) => {
    const mcpTools = await loadMcpTools();
    const toolNode = new ToolNode(mcpTools);

    const shouldContinue = (state: typeof GraphState.State) => {
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
      if (lastMessage.tool_calls?.length) {
        log.debug("MCP Agent - tool calls detected: ", lastMessage.tool_calls);
        const toolNames = lastMessage.tool_calls.map((toolCall) => toolCall.name);
        const interruptRequest = {
          question: "The agent has requested to use a tool",
          options: ["yes", "no"],
          actionToApprove: { action: toolNames },
          requestString: "The agent wants to use this tool: " + toolNames,
        };
        const review = interrupt(interruptRequest);
        log.debug("Tool call review: ", review);
        if (review !== "yes") {
          log.debug("[Tool invocation] - action not approved");
          const toolMessages: ToolMessage[] = [];
          lastMessage.tool_calls.forEach((toolCall) => {
            if (toolCall.id) {
              const toolMessage = new ToolMessage({
                tool_call_id: toolCall.id,
                content: "The user denied the action",
                name: toolCall.name,
              });
              toolMessages.push(toolMessage);
            }
          });
          log.debug("ToolMessages output: ", toolMessages);
          return new Command({ goto: "agent", update: { messages: toolMessages } });
        }
        return new Command({ goto: "tools" });
      }
      return new Command({ goto: "teardownNode" });
    };

    const callModel = async (state: typeof GraphState.State) => {
      log.debug("MCP Agent - called with input: ", state);
      const model = useModelProvider().getModel();
      if (!model) {
        return;
      }
      const boundModel = model.bindTools(mcpTools);
      const response = await boundModel.invoke(state.messages);
      log.debug("MCP Agent - response: ", response);
      return { messages: [response] };
    };

    return new StateGraph(GraphState)
      .addNode("agent", callModel)
      .addNode("tools", toolNode)
      .addNode("teardownNode", teardownNode)
      .addNode("shouldContinue", shouldContinue, { ends: ["agent", "tools", "teardownNode"] })
      .addEdge("__start__", "agent")
      .addEdge("tools", "agent")
      .addEdge("agent", "shouldContinue")
      .addEdge("teardownNode", "__end__")
      .compile({ checkpointer: new PersistentMemorySaver(checkpointNamespace(clusterId, "mcp")) });
  };

  return { buildAgentSystem, loadMcpTools };
};
