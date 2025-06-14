import { HumanMessage } from "@langchain/core/messages";
import { RunnableLambda } from "@langchain/core/runnables";
import { Command, CompiledStateGraph, MemorySaver, StateGraph } from "@langchain/langgraph";
import { useAgentAnalyzer } from "./analyzer-agent";
import { useConclusionsAgent } from "./conclusions-agent";
import { useGeneralPurposeAgent } from "./general-purpose-agent";
import { useAgentKubernetesOperator } from "./kubernetes-operator-agent";
import { teardownNode } from "./nodes/teardown";
import { GraphState } from "./state/graph-state";
import { useAgentSupervisor } from "./supervisor-agent";

/**
 * Multi-agent system for Freelens
 * @returns the multi-agent system invokable
 */
export const useFreelensAgentSystem = () => {
  const subAgents = ["agentAnalyzer", "kubernetesOperator", "generalPurposeAgent"];
  const conclusionsAgentName = "conclusionsAgent";
  const subAgentResponsibilities = [
    "agentAnalyzer: Reads cluster events and find for warnings and errors",
    "kubernetesOperator: Operates on the cluster in write mode (for example apply changes) and then exits",
    "generalPurposeAgent: Handles general queries including but not limited to: Kubernetes conceptual explanations, best practices, architecture patterns, and non-Kubernetes technical questions. This agent doesn't interact with the live cluster but provides comprehensive knowledge-based responses.",
  ];

  const supervisorAgentNode = async (state: typeof GraphState.State) => {
    console.log("Supervisor agent - calling agent supervisor with input: ", state);
    const agentSupervisor = await useAgentSupervisor(state.modelName, state.modelApiKey).getAgent(
      subAgents,
      subAgentResponsibilities,
    );
    const response = await agentSupervisor.invoke({ messages: state.messages });
    console.log("Supervisor agent - supervisor response", response);

    // handoff
    if (response.goto === "__end__") {
      response.goto = conclusionsAgentName;
    }
    return new Command({ goto: response.goto });
  };

  const agentAnalyzerNode = async (state: typeof GraphState.State) => {
    console.log("Analyzer Agent - calling agent analyzer with input: ", state);
    const agentAnalyzer = useAgentAnalyzer(state.modelName, state.modelApiKey).getAgent();
    const result = await agentAnalyzer.invoke(state);
    const lastMessage = result.messages[result.messages.length - 1];
    console.log("Analyzer Agent - analysis result: ", result);
    return {
      messages: [new HumanMessage({ content: lastMessage.content })],
    };
  };

  const kubernetesOperatorNode = async (state: typeof GraphState.State) => {
    console.log("Kubernetes Operator Agent - called with input: ", state);
    const agentKubernetesOperator = useAgentKubernetesOperator(state.modelName, state.modelApiKey).getAgent();
    const result = await agentKubernetesOperator.invoke(state);
    const lastMessage = result.messages[result.messages.length - 1];
    console.log("Kubernetes Operator - k8s operator result: ", result);
    return {
      messages: [new HumanMessage({ content: lastMessage.content })],
    };
  };

  const generalPurposeAgentNode = async (state: typeof GraphState.State) => {
    console.log("General Purpose Agent - called with input: ", state);
    const generalPurposeAgent = useGeneralPurposeAgent(state.modelName, state.modelApiKey).getAgent();
    const result = await generalPurposeAgent.invoke(state);
    const lastMessage = result.messages[result.messages.length - 1];
    console.log("General Purpose Agent - response: ", result);
    return {
      messages: [new HumanMessage({ content: lastMessage.content })],
    };
  };

  const conclusionsAgentNode = async (state: typeof GraphState.State) => {
    console.log("Conclusions Agent - called with input: ", state);
    const conclusionsAgent = useConclusionsAgent(state.modelName, state.modelApiKey).getAgent();
    const result = await conclusionsAgent.invoke(state);
    const lastMessage = result.messages[result.messages.length - 1];
    console.log("Conclusions Agent - conclusions: ", result);
    return {
      messages: [new HumanMessage({ content: lastMessage.content })],
    };
  };

  const buildAgentSystem = (): CompiledStateGraph<object, object, string, any, any, any> => {
    const graph = new StateGraph(GraphState)
      .addNode("supervisorAgent", RunnableLambda.from(supervisorAgentNode).withConfig({ tags: ["nostream"] }), {
        ends: [...subAgents, conclusionsAgentName],
      })
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

    return graph;
  };

  return { buildAgentSystem };
};
