import { AIMessage } from "@langchain/core/messages";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIModels } from "../provider/ai-models";
import { useModelProvider } from "../provider/model-provider";
import { createDeployment, createPod, deleteDeployment, deletePod } from "./tools/tools";

export const useAgentKubernetesOperator = (modelName: AIModels, modelApiKey: string) => {
  const model = useModelProvider().getModel({ modelName: modelName, apiKey: modelApiKey });

  const getAgent = () => {
    const tools = [createPod, createDeployment, deletePod, deleteDeployment];
    const toolNode = new ToolNode(tools);
    const boundModel = model.bindTools(tools);

    const shouldContinue = ({ messages }: typeof MessagesAnnotation.State) => {
      const lastMessage = messages[messages.length - 1] as AIMessage;
      if (lastMessage.tool_calls?.length) {
        return "tools";
      }
      return "__end__";
    };

    const callModel = async (state: typeof MessagesAnnotation.State) => {
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
