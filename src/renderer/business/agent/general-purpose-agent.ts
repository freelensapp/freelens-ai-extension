import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { withCustomAgentRules } from "../provider/agent-rules-provider";
import { useModelProvider } from "../provider/model-provider";
import { GENERAL_PURPOSE_AGENT_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";

export const useGeneralPurposeAgent = () => {
  const model = useModelProvider().getModel();

  const getAgent = () => {
    return (
      model &&
      createReactAgent({
        llm: model,
        tools: [],
        prompt: withCustomAgentRules(GENERAL_PURPOSE_AGENT_PROMPT_TEMPLATE),
      })
    );
  };

  return { getAgent };
};
