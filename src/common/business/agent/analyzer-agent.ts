import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { AIModels } from "../provider/ai-models";
import { useModelProvider } from "../provider/model-provider";
import { AGENT_ANALYZER_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";
import { getNamespaces, getWarningEventsByNamespace } from "./tools/tools";

export const useAgentAnalyzer = (modelName: AIModels, modelApiKey: string) => {
  const model = useModelProvider().getModel({ modelName: modelName, apiKey: modelApiKey });

  const getAgent = () => {
    return createReactAgent({
      llm: model,
      tools: [getNamespaces, getWarningEventsByNamespace],
      stateModifier: AGENT_ANALYZER_PROMPT_TEMPLATE,
    });
  };

  return { getAgent };
};
