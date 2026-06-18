import { createReactAgent } from "@langchain/langgraph/prebuilt";
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
        prompt: GENERAL_PURPOSE_AGENT_PROMPT_TEMPLATE,
      })
    );
  };

  return { getAgent };
};
