import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { PreferencesStore } from "../../../common/store";
import { useModelProvider } from "../provider/model-provider";
import { AGENT_ANALYZER_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";
import { createOllamaReactAgent, isOllamaModel } from "./ollama-agent-helper";
import { getNamespaces, getWarningEventsByNamespace } from "./tools/tools";

export const useAgentAnalyzer = () => {
  const model = useModelProvider().getModel();
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();

  const getAgent = () => {
    if (!model) return undefined;

    const tools = [getNamespaces, getWarningEventsByNamespace];

    if (isOllamaModel(preferencesStore.selectedModel)) {
      return createOllamaReactAgent(model, tools, AGENT_ANALYZER_PROMPT_TEMPLATE);
    }

    return createReactAgent({
      llm: model,
      tools,
      stateModifier: AGENT_ANALYZER_PROMPT_TEMPLATE,
    });
  };

  return { getAgent };
};
