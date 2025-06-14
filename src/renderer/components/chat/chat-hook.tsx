// @ts-ignore
import React from "react";

import { Command } from "@langchain/langgraph";
import { useEffect, useRef } from "react";
import { MessageObject } from "../../../common/business/objects/message-object";
import { getInterruptMessage, getTextMessage } from "../../../common/business/objects/message-object-provider";
import { MessageType } from "../../../common/business/objects/message-type";
import { AgentService, useAgentService } from "../../../common/business/service/agent-service";
import useAiAnalysisService, { AiAnalysisService } from "../../../common/business/service/ai-analysis-service";
import { PreferencesStore } from "../../../common/store";

interface ApprovalInterrupt {
  question: string;
  options: string[];
  actionToApprove: any; // You might want to type this more specifically
  requestString: string;
}

function isApprovalInterrupt(value: unknown): value is ApprovalInterrupt {
  return (
    typeof value === "object" &&
    value !== null &&
    "question" in value &&
    "options" in value &&
    "actionToApprove" in value &&
    "requestString" in value
  );
}

export const useChatHook = (preferencesStore: PreferencesStore) => {
  const aiAnalysisService: AiAnalysisService = useAiAnalysisService(preferencesStore);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollToBottom();
  }, []);

  const sendMessage = (message: MessageObject) => {
    preferencesStore.addMessage(message);
    scrollToBottom();
  };

  const sendMessageToAgent = (message: MessageObject) => {
    console.log("Send message to agent: ", message);
    sendMessage(message);

    if (message.sent) {
      if (MessageType.EXPLAIN === message.type) {
        analyzeEvent(message).finally(() => scrollToBottom());
      } else if (preferencesStore.isConversationInterrupted()) {
        console.log("Conversation is interrupted, resuming...");
        preferencesStore.conversationIsNotInterrupted();
        runAgent(new Command({ resume: message.text })).finally(() => null);
      } else {
        const agentInput = {
          modelName: preferencesStore.selectedModel,
          modelApiKey: preferencesStore.apiKey,
          messages: [{ role: "user", content: message.text }],
        };
        runAgent(agentInput).finally(() => null);
      }
    } else {
      console.error("You cannot call sendMessageToAgent with 'sent: false'");
    }
  };

  const analyzeEvent = async (lastMessage: MessageObject) => {
    try {
      const analysisResultStream = aiAnalysisService.analyze(lastMessage.text);
      let aiResult = "";
      sendMessage(getTextMessage(aiResult, false));
      for await (const chunk of analysisResultStream) {
        // console.log("Streaming to UI chunk: ", chunk);
        preferencesStore.updateLastMessage(chunk);
        scrollToBottom();
      }
    } catch (error) {
      console.error("Error in AI analysis: ", error);
      sendMessage(getTextMessage(`Error in AI analysis: ${error instanceof Error ? error.message : error}`, false));
    }
  };

  const runAgent = async (agentInput: object | Command) => {
    try {
      preferencesStore.isLoading = true;
      const activeAgent = await preferencesStore.getActiveAgent();
      const agentService: AgentService = useAgentService(activeAgent);
      const agentResponseStream = agentService.run(agentInput, preferencesStore.conversationId);
      let aiResult = "";
      sendMessage(getTextMessage(aiResult, false));
      for await (const chunk of agentResponseStream) {
        // console.log("Streaming to UI chunk: ", chunk);
        if (typeof chunk === "string") {
          preferencesStore.updateLastMessage(chunk);
        }

        // check if the chunk is an approval interrupt
        if (typeof chunk === "object" && isApprovalInterrupt(chunk.value)) {
          console.log("Approval interrupt received: ", chunk);
          sendMessage(getInterruptMessage(chunk, false));
          preferencesStore.conversationIsInterrupted();
        }
      }
    } catch (error) {
      console.error("Error while running Freelens Agent: ", error);

      sendMessage(
        getTextMessage(`Error while running Freelens Agent: ${error instanceof Error ? error.message : error}`, false),
      );
    } finally {
      preferencesStore.isLoading = false;
    }
  };

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  return { containerRef, sendMessage, sendMessageToAgent };
};
