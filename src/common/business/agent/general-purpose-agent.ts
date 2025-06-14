import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { AIModels } from "../provider/ai-models";
import { useModelProvider } from "../provider/model-provider";
import { GENERAL_PURPOSE_AGENT_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";

export const useGeneralPurposeAgent = (modelName: AIModels, modelApiKey: string) => {
  const model = useModelProvider().getModel({ modelName: modelName, apiKey: modelApiKey });

  const getAgent = () => {
    return createReactAgent({
      llm: model,
      tools: [],
      stateModifier: GENERAL_PURPOSE_AGENT_PROMPT_TEMPLATE,
    });
  };

  return { getAgent };
};
