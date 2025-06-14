import { ChatPromptTemplate } from "@langchain/core/prompts";
import { PreferencesStore } from "../../store";
import { useModelProvider } from "../provider/model-provider";
import { ANALYSIS_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";

export interface AiAnalysisService {
  analyze: (message: string) => AsyncGenerator<string, void, unknown>;
}

const useAiAnalysisService = (preferencesStore: PreferencesStore): AiAnalysisService => {
  const analyze = async function* (message: string) {
    console.log("Starting AI analysis for message: ", message);

    if (!message) {
      throw new Error("No message provided for analysis.");
    }

    if (!preferencesStore.apiKey) {
      throw new Error("API key is required. Use the settings to register it.");
    }

    const model = useModelProvider().getModel({
      modelName: preferencesStore.selectedModel,
      apiKey: preferencesStore.apiKey,
    });
    const chain = ChatPromptTemplate.fromTemplate(ANALYSIS_PROMPT_TEMPLATE).pipe(model);
    const streamResponse = await chain.stream({ context: message });

    for await (const chunk of streamResponse) {
      if (chunk?.content) {
        yield String(chunk.content);
      }
    }
  };

  return { analyze };
};

export default useAiAnalysisService;
