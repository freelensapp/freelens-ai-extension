import { BaseMessage } from "@langchain/core/messages";
import { Annotation, Messages, messagesStateReducer } from "@langchain/langgraph";

export const GraphState = Annotation.Root({
  modelName: Annotation<string>,
  modelApiKey: Annotation<string>,
  messages: Annotation<BaseMessage[], Messages>({
    reducer: messagesStateReducer,
  }),
});
