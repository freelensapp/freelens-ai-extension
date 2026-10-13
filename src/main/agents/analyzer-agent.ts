import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { withCustomAgentRules } from "../provider/agent-rules-provider";
import { useModelProvider } from "../provider/model-provider";
import { AGENT_ANALYZER_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";
import {
  getClusterVersion,
  getKubernetesResource,
  getNamespaces,
  getPodLogs,
  getWarningEventsByNamespace,
  listKubernetesResources,
} from "./tools/tools";

export const useAgentAnalyzer = () => {
  const model = useModelProvider().getModel();

  const getAgent = () => {
    return (
      model &&
      createReactAgent({
        llm: model,
        tools: [
          getNamespaces,
          getClusterVersion,
          getWarningEventsByNamespace,
          listKubernetesResources,
          getKubernetesResource,
          getPodLogs,
        ],
        prompt: withCustomAgentRules(AGENT_ANALYZER_PROMPT_TEMPLATE),
      })
    );
  };

  return { getAgent };
};
