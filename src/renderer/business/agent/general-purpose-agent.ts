import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { PreferencesStore } from "../../../common/store";
import { useModelProvider } from "../provider/model-provider";
import { GENERAL_PURPOSE_AGENT_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";
import { createOllamaReactAgent, isOllamaModel } from "./ollama-agent-helper";

export const useGeneralPurposeAgent = () => {
  const model = useModelProvider().getModel();
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  const getAgent = () => {
    if (!model) return undefined;

    if (isOllamaModel(preferencesStore.selectedModel)) {
      return createOllamaReactAgent(model, [], GENERAL_PURPOSE_AGENT_PROMPT_TEMPLATE);
    }

    return createReactAgent({
      llm: model,
      tools: [],
      stateModifier: GENERAL_PURPOSE_AGENT_PROMPT_TEMPLATE,
    });
  };

  return { getAgent };
};
