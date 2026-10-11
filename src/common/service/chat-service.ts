import { Command } from "@langchain/langgraph";
import {
  answerApproval as answerApprovalInMain,
  getAgentChat,
  sendAgentCommand,
} from "../../renderer/business/agent-client/agent-client";
import { getErrorMessage, getInterruptMessage } from "../../renderer/business/objects/message-object-provider";
import { MessageType } from "../../renderer/business/objects/message-type";
import { DEFAULT_OPENAI_BASE_URL } from "../../renderer/business/provider/ai-models";
import {
  AgentService,
  isContextSizeChunk,
  isReasoningChunk,
  isTokenUsageChunk,
  useAgentService,
} from "../../renderer/business/service/agent-service";
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
          void explainEvent(message.text);
        } else {
          _sendMessage(message);
          void promptAgent(message.text);
        }
      } else {
        log.error("You cannot call sendMessageToAgent with 'sent: false'");
      }
    } catch {
      applicationStatusStore.setLoading(false);
    }
  };

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
      void explainEvent(retryContext.text);
    } else if (retryContext.kind === "resume") {
      runAgent(new Command({ resume: retryContext.text }), retryContext).finally(() =>
        applicationStatusStore.setLoading(false),
      );
    } else {
      void promptAgent(retryContext.text);
    }
  };

  // Sends a prompt to this cluster's pi agent in main. The answer streams back
  // as envelopes that the application context folds into the transcript; the
  // spinner stops when the run settles. A prompt main refuses before the run
  // starts (no model, no credentials) shows its reason right away.
  const promptAgent = async (text: string) => {
    const response = await sendAgentCommand(applicationStatusStore.clusterId, { type: "prompt", message: text });
    if (!response.success) {
      _sendMessage(getErrorMessage(response.error, { kind: "message", text }));
      applicationStatusStore.setLoading(false);
      return;
    }
    // pi may queue or handle the prompt without starting a run, so no run
    // events would clear the spinner.
    const disposition = (response.data as { disposition?: string } | undefined)?.disposition;
    if (disposition && disposition !== "started" && !getAgentChat()?.isRunning) {
      applicationStatusStore.setLoading(false);
    }
  };

  // Resume a paused run with the answer picked from an interrupt's approval
  // buttons ("yes"/"no"). The answer is never added to the transcript: it was
  // not typed by the user, and the approval/rejection is already conveyed by the
  // interrupt's status icon. Resuming through this dedicated path (instead of
  // sendMessageToAgent) makes that independent of the transient
  // `isConversationInterrupted` flag, which is not restored after an app restart
  // even though the pending interrupt itself is.
  const resumeInterrupt = (option: string) => {
    try {
      // A fresh user action supersedes any earlier failure: drop stale error
      // messages (and their "Retry" buttons) before resuming the run.
      applicationStatusStore.removeErrorMessages();
      applicationStatusStore.setLoading(true);
      log.debug("Resuming interrupted conversation with answer: ", option);
      runAgent(new Command({ resume: option }), { kind: "resume", text: option }).finally(() => {
        applicationStatusStore.setLoading(false);
      });
    } catch {
      applicationStatusStore.setLoading(false);
    }
  };

  // Answers a pi agent approval card. The card itself changes when main
  // broadcasts the result; an answer main no longer waits for (the run was
  // stopped meanwhile) is only logged.
  const answerApproval = async (approvalId: string, confirmed: boolean, approveAll = false) => {
    const response = await answerApprovalInMain(applicationStatusStore.clusterId, approvalId, confirmed, approveAll);
    if (!response.success) {
      log.error("The approval answer was not accepted: ", response.error);
    }
  };

  const changeInterruptStatus = (id: string, status: boolean) => {
    applicationStatusStore.changeInterruptStatus(id, status);
  };

  // AI Explain runs in main as a one-shot pi call with no tools. Its answer
  // streams back as envelopes like a chat answer, but is not saved into the
  // cluster's chat session. An explanation main refuses (no model, a run going)
  // shows its reason right away.
  const explainEvent = async (text: string) => {
    const response = await sendAgentCommand(applicationStatusStore.clusterId, { type: "explain", message: text });
    if (!response.success) {
      _sendMessage(getErrorMessage(`Error in AI analysis: ${response.error}`, { kind: "explain", text }));
      applicationStatusStore.setLoading(false);
      return;
    }
    const disposition = (response.data as { disposition?: string } | undefined)?.disposition;
    if (disposition && disposition !== "started" && !getAgentChat()?.isRunning) {
      applicationStatusStore.setLoading(false);
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

        // The counter, cost and context gauge come from the pi agent's stats in
        // main now; this old path's usage is not shown.
        if (isTokenUsageChunk(chunk) || isContextSizeChunk(chunk)) {
          continue;
        }

        // check if the chunk is an approval interrupt
        if (isApprovalInterrupt(chunk.value)) {
          log.debug("Approval interrupt received: ", chunk);
          _sendMessage(getInterruptMessage(chunk, false));
          endedWithInterrupt = true;
        }
      }
      applicationStatusStore.setConversationInterrupted(endedWithInterrupt);
    } catch (error) {
      log.error("Error while running Freelens Agent: ", error);

      _sendMessage(
        getErrorMessage(`Error while running Freelens Agent: ${getReadableErrorMessage(error)}`, retryContext),
      );
    }
  };

  return { sendMessageToAgent, resumeInterrupt, changeInterruptStatus, answerApproval, retry };
};

export default useChatService;
