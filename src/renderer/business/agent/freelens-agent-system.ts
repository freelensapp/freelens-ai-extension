import { HumanMessage } from "@langchain/core/messages";
import { RunnableLambda, RunnableLike } from "@langchain/core/runnables";
import { Command, MemorySaver, StateGraph } from "@langchain/langgraph";
import useLog from "../../../common/utils/logger/logger-service";
import { useAgentAnalyzer } from "./analyzer-agent";
import { useConclusionsAgent } from "./conclusions-agent";
import { useGeneralPurposeAgent } from "./general-purpose-agent";
import { useAgentKubernetesOperator } from "./kubernetes-operator-agent";
import {
  buildUnsupportedToolCallMessage,
  containsLeakedToolCallMarkup,
  findUnknownToolCalls,
  LEAKED_TOOL_CALL_MESSAGE,
} from "./leaked-tool-calls";
import { teardownNode } from "./nodes/teardown";
import { GraphState } from "./state/graph-state";
import { useAgentSupervisor } from "./supervisor-agent";
import { allToolNames, toolFunctionDescriptions } from "./tools/tools";

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
    "agentAnalyzer: Reads and inspects live cluster resources (pods, deployments, services, CRDs, and other kinds), events, namespaces, warnings and errors, and reads container logs from pods. Use it for any read-only query about the current state of the cluster, including requests to view, read, show, or tail pod/container logs.",
    'kubernetesOperator: Performs any change to the cluster - create, update, replace, patch, annotate, label, scale, restart, delete resources, and trigger operations such as Flux/Argo reconciliation (which is done by patching an annotation). Route here for any request that modifies, triggers, reconciles, restarts, scales, suspends, resumes, rolls out, or applies anything, even when the request uses tool-specific jargon instead of the word "write".',
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

    // The supervisor must return a structured routing decision ({ reflection,
    // goto }). When the endpoint does not parse the model's tool calls
    // server-side, the markup leaks into the message text, the parser yields no
    // tool call, and `response` is undefined. Fail with an actionable message
    // instead of crashing on `response.goto` of undefined.
    if (!response || typeof response.goto !== "string") {
      log.error("Supervisor agent returned no routing decision", response);
      throw new Error(`The supervisor did not return a structured routing decision. ${LEAKED_TOOL_CALL_MESSAGE}`);
    }

    let goto = response.goto;
    if (goto === "__end__") {
      goto = conclusionsAgentName;
    }
    return new Command({ goto });
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
    const analyzerUnknownTools = findUnknownToolCalls(result.messages, allToolNames);
    if (analyzerUnknownTools.length > 0) {
      log.error("Analyzer Agent - unsupported tool call requested", analyzerUnknownTools);
      throw new Error(buildUnsupportedToolCallMessage(analyzerUnknownTools));
    }
    if (containsLeakedToolCallMarkup(lastMessage.content)) {
      log.error("Analyzer Agent - leaked tool-call markup in response", lastMessage.content);
      throw new Error(LEAKED_TOOL_CALL_MESSAGE);
    }
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
    const operatorUnknownTools = findUnknownToolCalls(result.messages, allToolNames);
    if (operatorUnknownTools.length > 0) {
      log.error("Kubernetes Operator - unsupported tool call requested", operatorUnknownTools);
      throw new Error(buildUnsupportedToolCallMessage(operatorUnknownTools));
    }
    if (containsLeakedToolCallMarkup(lastMessage.content)) {
      log.error("Kubernetes Operator - leaked tool-call markup in response", lastMessage.content);
      throw new Error(LEAKED_TOOL_CALL_MESSAGE);
    }
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
    if (containsLeakedToolCallMarkup(lastMessage.content)) {
      log.error("General Purpose Agent - leaked tool-call markup in response", lastMessage.content);
      throw new Error(LEAKED_TOOL_CALL_MESSAGE);
    }
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
