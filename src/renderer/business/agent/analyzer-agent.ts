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
        // The analyzer is an intermediate worker on the read-only path; its
        // answer is restated by the conclusions agent. Tag the model with
        // `nostream` so `messages` stream mode suppresses its tokens. The tag
        // must sit on the model run itself - a `nostream` tag on the graph node
        // does not cross into this `createReactAgent` subgraph to reach the LLM.
        llm: model.withConfig({ tags: ["nostream"] }),
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
