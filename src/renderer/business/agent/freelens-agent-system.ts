import { HumanMessage } from "@langchain/core/messages";
import { RunnableLambda, RunnableLike } from "@langchain/core/runnables";
import { Command, MemorySaver, StateGraph } from "@langchain/langgraph";
import useLog from "../../../common/utils/logger/logger-service";
import { useAgentAnalyzer } from "./analyzer-agent";
import { useConclusionsAgent } from "./conclusions-agent";
import { useGeneralPurposeAgent } from "./general-purpose-agent";
import { useAgentKubernetesOperator } from "./kubernetes-operator-agent";
import { teardownNode } from "./nodes/teardown";
import { GraphState } from "./state/graph-state";
import { useAgentSupervisor } from "./supervisor-agent";
import { toolFunctionDescriptions } from "./tools/tools";

export type FreeLensAgent = ReturnType<ReturnType<typeof useFreeLensAgentSystem>["buildAgentSystem"]>;

/**
 * Multi-agent system for Freelens
 * @returns the multi-agent system invokable
 */
export const useFreeLensAgentSystem = () => {
  const { log } = useLog("useFreeLensAgentSystem");
  const subAgents = ["agentAnalyzer", "kubernetesOperator", "generalPurposeAgent"];
  const conclusionsAgentName = "conclusionsAgent";
  const subAgentResponsibilities = [
    "agentAnalyzer: Reads cluster events and find for warnings and errors",
    "kubernetesOperator: Operates on the cluster in write mode (for example apply changes) and then exits",
    "generalPurposeAgent: Handles general queries including but not limited to: Kubernetes conceptual explanations, best practices, architecture patterns, and non-Kubernetes technical questions. This agent doesn't interact with the live cluster but provides comprehensive knowledge-based responses.",
  ];
  const availableTools = toolFunctionDescriptions;

  const supervisorAgentNode = async (state: typeof GraphState.State) => {
    log.debug("Supervisor agent - calling agent supervisor with input: ", state);
    const agentSupervisor = await useAgentSupervisor().getAgent(subAgents, subAgentResponsibilities);
    if (!agentSupervisor) {
      return;
    }
    const response: any = await agentSupervisor.invoke({ messages: state.messages });
    log.debug("Supervisor agent - supervisor response", response);

    // TOOD check why response is unknown
    if (response.goto === "__end__") {
      response.goto = conclusionsAgentName;
    }
    return new Command({ goto: response.goto });
  };

  const agentAnalyzerNode = async (state: typeof GraphState.State) => {
    log.debug("Analyzer Agent - calling agent analyzer with input: ", state);
    const agentAnalyzer = useAgentAnalyzer().getAgent();
    if (!agentAnalyzer) {
      return;
    }
    const result = await agentAnalyzer.invoke(state);
    const lastMessage = result.messages[result.messages.length - 1];
    log.debug("Analyzer Agent - analysis result: ", result);
    return {
      messages: [new HumanMessage({ content: lastMessage.content })],
    };
  };

  const kubernetesOperatorNode = async (state: typeof GraphState.State) => {
    log.debug("Kubernetes Operator Agent - called with input: ", state);
    const agentKubernetesOperator = useAgentKubernetesOperator().getAgent();
    if (!agentKubernetesOperator) {
      return;
    }
    const result = await agentKubernetesOperator.invoke(state);
    const lastMessage = result.messages[result.messages.length - 1];
    log.debug("Kubernetes Operator - k8s operator result: ", result);
    return {
      messages: [new HumanMessage({ content: lastMessage.content })],
    };
  };

  const generalPurposeAgentNode = async (state: typeof GraphState.State) => {
    log.debug("General Purpose Agent - called with input: ", state);
    const generalPurposeAgent = useGeneralPurposeAgent().getAgent();
    if (!generalPurposeAgent) {
      return;
    }
    const result = await generalPurposeAgent.invoke(state);
    const lastMessage = result.messages[result.messages.length - 1];
    log.debug("General Purpose Agent - response: ", result);
    return {
      messages: [new HumanMessage({ content: lastMessage.content })],
    };
  };

  const conclusionsAgentNode = async (state: typeof GraphState.State) => {
    log.debug("Conclusions Agent - called with input: ", state);
    const conclusionsAgent = useConclusionsAgent().getAgent();
    if (!conclusionsAgent) {
      return;
    }
    const result = await conclusionsAgent.invoke(state);
    const lastMessage = result.messages[result.messages.length - 1];
    log.debug("Conclusions Agent - conclusions: ", result);
    return {
      messages: [new HumanMessage({ content: lastMessage.content })],
    };
  };

  const buildAgentSystem = () => {
    return new StateGraph(GraphState)
      .addNode(
        "supervisorAgent",
        RunnableLambda.from(supervisorAgentNode).withConfig({ tags: ["nostream"] }) as RunnableLike,
        {
          ends: [...subAgents, conclusionsAgentName],
        },
      )
      .addNode("agentAnalyzer", agentAnalyzerNode)
      .addNode("kubernetesOperator", kubernetesOperatorNode)
      .addNode("generalPurposeAgent", generalPurposeAgentNode)
      .addNode(conclusionsAgentName, conclusionsAgentNode)
      .addNode("teardownNode", teardownNode)
      .addEdge("__start__", "supervisorAgent")
      .addEdge("agentAnalyzer", "supervisorAgent")
      .addEdge("kubernetesOperator", "teardownNode")
      .addEdge("generalPurposeAgent", "teardownNode")
      .addEdge(conclusionsAgentName, "teardownNode")
      .addEdge("teardownNode", "__end__")
      .compile({ checkpointer: new MemorySaver() });
  };

  return { buildAgentSystem, availableTools };
};
