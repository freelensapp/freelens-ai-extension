import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { withCustomAgentRules } from "../provider/agent-rules-provider";
import { useModelProvider } from "../provider/model-provider";
import { CONCLUSIONS_AGENT_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";

export const useConclusionsAgent = () => {
  const model = useModelProvider().getModel();

  const getAgent = () => {
    return (
      model &&
      createReactAgent({
        llm: model,
        tools: [],
        prompt: withCustomAgentRules(CONCLUSIONS_AGENT_PROMPT_TEMPLATE),
      })
    );
  };

  return { getAgent };
};
