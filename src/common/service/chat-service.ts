import { Command } from "@langchain/langgraph";
import { getInterruptMessage, getTextMessage } from "../../renderer/business/objects/message-object-provider";
import { MessageType } from "../../renderer/business/objects/message-type";
import { DEFAULT_OPENAI_BASE_URL } from "../../renderer/business/provider/ai-models";
import { AgentService, isReasoningChunk, useAgentService } from "../../renderer/business/service/agent-service";
import { AiAnalysisService, useAiAnalysisService } from "../../renderer/business/service/ai-analysis-service";
import { ActionToApprove } from "../../renderer/components/chat";
import { useApplicationStatusStore } from "../../renderer/context/application-context";
import { PreferencesStore } from "../store";
import useLog from "../utils/logger/logger-service";

import type { MessageObject } from "../../renderer/business/objects/message-object";

export interface ApprovalInterrupt {
  question: string;
  options: string[];
  actionToApprove: ActionToApprove;
  requestString: string;
}

const useChatService = () => {
  const { log } = useLog("useChatService");
  const applicationStatusStore = useApplicationStatusStore();
  const aiAnalysisService: AiAnalysisService = useAiAnalysisService(applicationStatusStore);

  const getReadableErrorMessage = (error: unknown) => {
    if (!(error instanceof Error)) {
      return String(error);
    }

    const message = error.message.toLowerCase();
    // Duck-type the OpenAI SDK error shape: APIError subclasses carry a numeric
    // `status`. APIConnectionError has status === undefined (the request never
    // reached the endpoint at all), while InternalServerError has status >= 500
    // (the proxy returned a 502/5xx because it could not reach the upstream).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorStatus = (error as any).status as number | undefined;

    // True connection failure: the renderer never reached the proxy (proxy not
    // started, wrong port, network blocked). APIConnectionError has no HTTP
    // status; the browser strips the URL from `Failed to fetch` so re-attach it.
    const isConnectionFailure =
      error.constructor?.name === "APIConnectionError" ||
      (errorStatus === undefined &&
        (message.includes("failed to fetch") || message.includes("fetch failed") || message.includes("network error")));

    if (isConnectionFailure) {
      // @ts-ignore
      const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
      const baseUrl = preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;
      const proxyHint =
        preferencesStore.aiProxyPort === null
          ? "the local AI proxy is not running yet"
          : `via the local AI proxy on port ${preferencesStore.aiProxyPort}`;
      return `Could not reach the AI endpoint ${baseUrl} (${proxyHint}). Check the base URL, your network connection, and that the endpoint is reachable. Original error: ${error.message}`;
    }

    // The proxy returned a 5xx (e.g. 502): the renderer reached the proxy
    // successfully, but the proxy could not reach the upstream endpoint.
    if (typeof errorStatus === "number" && errorStatus >= 500) {
      // @ts-ignore
      const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
      const baseUrl = preferencesStore.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL;
      return `The AI proxy could not reach the upstream endpoint ${baseUrl}. Check that the endpoint is running and the base URL is correct. Original error: ${error.message}`;
    }

    const isGeminiTemporaryOverload =
      message.includes("failed to parse stream") ||
      message.includes("503") ||
      message.includes("unavailable") ||
      message.includes("high demand") ||
      message.includes("429") ||
      message.includes("too many requests");

    if (isGeminiTemporaryOverload) {
      return "Gemini is temporarily overloaded (high demand). Please retry in a few seconds.";
    }

    return error.message;
  };

  const _sendMessage = (message: MessageObject) => {
    applicationStatusStore.addMessage(message);
  };

  const sendMessageToAgent = (message: MessageObject) => {
    try {
      applicationStatusStore.setLoading(true);
      log.debug("Send message to agent: ", message);
      _sendMessage(message);

      if (message.sent) {
        if (MessageType.EXPLAIN === message.type) {
          analyzeEvent(message).finally(() => applicationStatusStore.setLoading(false));
        } else if (applicationStatusStore.isConversationInterrupted) {
          log.debug("Conversation is interrupted, resuming...");
          runAgent(new Command({ resume: message.text })).finally(() => {
            applicationStatusStore.setLoading(false);
          });
        } else {
          const agentInput = {
            modelName: applicationStatusStore.selectedModel,
            modelApiKey: applicationStatusStore.apiKey,
            messages: [{ role: "user", content: message.text }],
          };
          runAgent(agentInput).finally(() => applicationStatusStore.setLoading(false));
        }
      } else {
        log.error("You cannot call sendMessageToAgent with 'sent: false'");
      }
    } catch {
      applicationStatusStore.setLoading(false);
    }
  };

  const changeInterruptStatus = (id: string, status: boolean) => {
    applicationStatusStore.changeInterruptStatus(id, status);
  };

  const analyzeEvent = async (lastMessage: MessageObject) => {
    try {
      const analysisResultStream = aiAnalysisService.analyze(lastMessage.text);
      for await (const chunk of analysisResultStream) {
        // log.debug("Streaming to UI chunk: ", chunk);
        applicationStatusStore.updateLastMessage(chunk);
      }
    } catch (error) {
      log.error("Error in AI analysis: ", error);
      _sendMessage(getTextMessage(`Error in AI analysis: ${getReadableErrorMessage(error)}`, false));
    }
  };

  const isApprovalInterrupt = (value: unknown): value is ApprovalInterrupt => {
    return (
      typeof value === "object" &&
      value !== null &&
      "question" in value &&
      "options" in value &&
      "actionToApprove" in value &&
      "requestString" in value
    );
  };

  const runAgent = async (agentInput: object | Command) => {
    try {
      const activeAgent = await applicationStatusStore.getActiveAgent();
      const agentService: AgentService = useAgentService(activeAgent);
      const agentResponseStream = agentService.run(agentInput, applicationStatusStore.conversationId);
      let endedWithInterrupt = false;
      let autoApproveAndResume = false;
      for await (const chunk of agentResponseStream) {
        // log.debug("Streaming to UI chunk: ", chunk);
        if (typeof chunk === "string") {
          applicationStatusStore.updateLastMessage(chunk);
          continue;
        }

        // Reasoning deltas update the message's separate reasoning field rather
        // than its visible answer text.
        if (isReasoningChunk(chunk)) {
          applicationStatusStore.updateLastMessageReasoning(chunk.reasoning);
          continue;
        }

        // check if the chunk is an approval interrupt
        if (isApprovalInterrupt(chunk.value)) {
          log.debug("Approval interrupt received: ", chunk);
          if (applicationStatusStore.bypassApprovals) {
            log.debug("Bypass approvals mode enabled: auto-approving tool use");
            const interruptMessage = getInterruptMessage(chunk, false);
            interruptMessage.approved = true;
            _sendMessage(interruptMessage);
            autoApproveAndResume = true;
          } else {
            _sendMessage(getInterruptMessage(chunk, false));
            endedWithInterrupt = true;
          }
        }
      }
      applicationStatusStore.setConversationInterrupted(endedWithInterrupt);
      if (autoApproveAndResume) {
        await runAgent(new Command({ resume: "yes" }));
      }
    } catch (error) {
      log.error("Error while running Freelens Agent: ", error);

      _sendMessage(getTextMessage(`Error while running Freelens Agent: ${getReadableErrorMessage(error)}`, false));
    }
  };

  return { sendMessageToAgent, changeInterruptStatus };
};

export default useChatService;
