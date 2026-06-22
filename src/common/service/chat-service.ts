import { Command } from "@langchain/langgraph";
import {
  getErrorMessage,
  getExplainMessage,
  getInterruptMessage,
} from "../../renderer/business/objects/message-object-provider";
import { MessageType } from "../../renderer/business/objects/message-type";
import { DEFAULT_OPENAI_BASE_URL } from "../../renderer/business/provider/ai-models";
import { AgentService, isReasoningChunk, useAgentService } from "../../renderer/business/service/agent-service";
import { AiAnalysisService, useAiAnalysisService } from "../../renderer/business/service/ai-analysis-service";
import { ActionToApprove } from "../../renderer/components/chat";
import { useApplicationStatusStore } from "../../renderer/context/application-context";
import { PreferencesStore } from "../store";
import useLog from "../utils/logger/logger-service";

import type { MessageObject, RetryContext } from "../../renderer/business/objects/message-object";

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
      // A fresh user action supersedes any earlier failure: drop stale error
      // messages (and their "Retry" buttons) before running the new query.
      applicationStatusStore.removeErrorMessages();
      applicationStatusStore.setLoading(true);
      log.debug("Send message to agent: ", message);

      if (message.sent) {
        if (MessageType.EXPLAIN === message.type) {
          _sendMessage(message);
          analyzeEvent(message).finally(() => applicationStatusStore.setLoading(false));
        } else if (applicationStatusStore.isConversationInterrupted) {
          log.debug("Conversation is interrupted, resuming...");
          // Do not display the resume answer (e.g. "yes"/"no") as a user message:
          // the user picked it from the approval buttons, they did not type it.
          runAgent(new Command({ resume: message.text }), { kind: "resume", text: message.text }).finally(() => {
            applicationStatusStore.setLoading(false);
          });
        } else {
          _sendMessage(message);
          runAgent(_buildAgentInput(message.text), { kind: "message", text: message.text }).finally(() =>
            applicationStatusStore.setLoading(false),
          );
        }
      } else {
        log.error("You cannot call sendMessageToAgent with 'sent: false'");
      }
    } catch {
      applicationStatusStore.setLoading(false);
    }
  };

  const _buildAgentInput = (text: string) => ({
    modelName: applicationStatusStore.selectedModel,
    modelApiKey: applicationStatusStore.apiKey,
    messages: [{ role: "user", content: text }],
  });

  // Re-run the query behind an error message, then drop that message so its
  // "Retry" button disappears from the transcript. The original user prompt is
  // already in the history, so retrying must not re-add it.
  const retry = (errorMessage: MessageObject) => {
    const retryContext = errorMessage.retryContext;
    applicationStatusStore.removeMessage(errorMessage.messageId);
    if (!retryContext) {
      return;
    }

    applicationStatusStore.setLoading(true);
    if (retryContext.kind === "explain") {
      analyzeEvent(getExplainMessage(retryContext.text)).finally(() => applicationStatusStore.setLoading(false));
    } else if (retryContext.kind === "resume") {
      runAgent(new Command({ resume: retryContext.text }), retryContext).finally(() =>
        applicationStatusStore.setLoading(false),
      );
    } else {
      runAgent(_buildAgentInput(retryContext.text), retryContext).finally(() =>
        applicationStatusStore.setLoading(false),
      );
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
      _sendMessage(
        getErrorMessage(`Error in AI analysis: ${getReadableErrorMessage(error)}`, {
          kind: "explain",
          text: lastMessage.text,
        }),
      );
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

  const runAgent = async (agentInput: object | Command, retryContext: RetryContext) => {
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
        await runAgent(new Command({ resume: "yes" }), retryContext);
      }
    } catch (error) {
      log.error("Error while running Freelens Agent: ", error);

      _sendMessage(
        getErrorMessage(`Error while running Freelens Agent: ${getReadableErrorMessage(error)}`, retryContext),
      );
    }
  };

  return { sendMessageToAgent, changeInterruptStatus, retry };
};

export default useChatService;
