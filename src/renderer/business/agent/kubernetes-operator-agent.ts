import { AIMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { useModelProvider } from "../provider/model-provider";
import { KUBERNETES_OPERATOR_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";
import {
  createKubernetesResource,
  deleteKubernetesResource,
  deletePod,
  getKubernetesResource,
  listKubernetesResources,
  patchKubernetesResource,
  restartKubernetesResource,
  updateKubernetesResource,
} from "./tools/tools";

export const useAgentKubernetesOperator = () => {
  const model = useModelProvider().getModel();

  const getAgent = () => {
    if (!model) {
      return;
    }

    const tools = [
      listKubernetesResources,
      getKubernetesResource,
      createKubernetesResource,
      updateKubernetesResource,
      patchKubernetesResource,
      deleteKubernetesResource,
      deletePod,
      restartKubernetesResource,
    ];
    const toolNode = new ToolNode(tools);
    const boundModel = model.bindTools(tools, { parallel_tool_calls: false });

    const callModel = async (state: { messages: AIMessage[] }) => {
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", KUBERNETES_OPERATOR_PROMPT_TEMPLATE],
        new MessagesPlaceholder("messages"),
      ]);
      const response = await prompt.pipe(boundModel).invoke({ messages: state.messages });
      return { messages: [response] };
    };

    const finish = async (state: { messages: AIMessage[] }) => {
      const prompt = ChatPromptTemplate.fromMessages([
        [
          "system",
          "Finish the interaction. If the user asked 2 things in the same message, remember the user that the agent can handle one task at time. Be professional.",
        ],
        new MessagesPlaceholder("messages"),
      ]);
      const response = await prompt.pipe(model).invoke({ messages: state.messages });
      return { messages: [response] };
    };

    return new StateGraph(MessagesAnnotation)
      .addNode("agent", callModel)
      .addNode("tools", toolNode)
      .addNode("finish", finish)
      .addEdge("__start__", "agent")
      .addEdge("agent", "tools")
      .addEdge("tools", "finish")
      .compile();
  };

  return { getAgent };
};
