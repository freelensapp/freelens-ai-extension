import { AIMessage, SystemMessage } from "@langchain/core/messages";
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

    const callModel = async (state: typeof MessagesAnnotation.State) => {
      const prompt = ChatPromptTemplate.fromMessages([
        new SystemMessage(KUBERNETES_OPERATOR_PROMPT_TEMPLATE),
        new MessagesPlaceholder("messages"),
      ]);
      const response = await prompt.pipe(boundModel).invoke({ messages: state.messages });
      return { messages: [response] };
    };

    const finish = async (state: typeof MessagesAnnotation.State) => {
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

    // Loop back to the model after each tool run so the operator can issue
    // sequential tool calls (e.g. list a resource to discover its namespace,
    // then mutate it). With `parallel_tool_calls: false` the model emits one
    // tool call per turn, so a straight `agent -> tools -> finish` line could
    // only ever run a single tool and any "discover, then act" task stalled
    // after the discovery step. Only fall through to `finish` once the model
    // stops requesting tools.
    const shouldContinue = (state: typeof MessagesAnnotation.State) => {
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
      return lastMessage?.tool_calls && lastMessage.tool_calls.length > 0 ? "tools" : "finish";
    };

    return new StateGraph(MessagesAnnotation)
      .addNode("agent", callModel)
      .addNode("tools", toolNode)
      .addNode("finish", finish)
      .addEdge("__start__", "agent")
      .addConditionalEdges("agent", shouldContinue, { tools: "tools", finish: "finish" })
      .addEdge("tools", "agent")
      .compile();
  };

  return { getAgent };
};
