import { AIMessage } from "@langchain/core/messages";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIModelsEnum } from "../provider/ai-models";
import { useModelProvider } from "../provider/model-provider";
import { createDeployment, createPod, deleteDeployment, deletePod } from "./tools/tools";

export const useAgentKubernetesOperator = (modelName: AIModelsEnum, modelApiKey: string) => {
  const model = useModelProvider().getModel({ modelName: modelName, apiKey: modelApiKey });

  const getAgent = () => {
    if (!model) {
      return;
    }

    const tools = [createPod, createDeployment, deletePod, deleteDeployment];
    const toolNode = new ToolNode(tools);
    const boundModel = model.bindTools(tools);

    const shouldContinue = ({ messages }: { messages: AIMessage[] }) => {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.tool_calls?.length) {
        return "tools";
      }
      return "__end__";
    };

    const callModel = async (state: { messages: AIMessage[] }) => {
      const response = await boundModel.invoke(state.messages);
      return { messages: [response] };
    };

    return new StateGraph(MessagesAnnotation)
      .addNode("agent", callModel)
      .addEdge("__start__", "agent")
      .addNode("tools", toolNode)
      .addEdge("tools", "agent")
      .addConditionalEdges("agent", shouldContinue)
      .compile();
  };

  return { getAgent };
};
