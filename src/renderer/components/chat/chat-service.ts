import useLog from "../../../common/utils/logger/logger-service";
import {
  answerApproval as answerApprovalInMain,
  getAgentChat,
  sendAgentCommand,
} from "../../business/agent-client/agent-client";
import { getErrorMessage } from "../../business/objects/message-object-provider";
import { MessageType } from "../../business/objects/message-type";
import { useApplicationStatusStore } from "../../context/application-context";

import type { AgentResponse } from "../../../common/agent-protocol";
import type { MessageObject } from "../../business/objects/message-object";

// The chat page's actions: each is a command to this cluster's pi agent in
// main, whose answer streams back as envelopes the agent client folds into the
// transcript.
const useChatService = () => {
  const { log } = useLog("useChatService");
  const applicationStatusStore = useApplicationStatusStore();

  const sendMessageToAgent = (message: MessageObject) => {
    if (!message.sent) {
      log.error("You cannot call sendMessageToAgent with 'sent: false'");
      return;
    }
    // A fresh user action supersedes any earlier failure: drop stale error
    // messages (and their "Retry" buttons) before running the new query.
    applicationStatusStore.removeErrorMessages();
    applicationStatusStore.setLoading(true);
    applicationStatusStore.addMessage(message);
    if (MessageType.EXPLAIN === message.type) {
      void explainEvent(message.text);
    } else {
      void promptAgent(message.text);
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
    } else {
      void promptAgent(retryContext.text);
    }
  };

  // pi may queue or handle a command without starting a run, so no run events
  // would clear the spinner.
  const clearSpinnerUnlessStarted = (response: Extract<AgentResponse, { success: true }>) => {
    const disposition = (response.data as { disposition?: string } | undefined)?.disposition;
    if (disposition && disposition !== "started" && !getAgentChat()?.isRunning) {
      applicationStatusStore.setLoading(false);
    }
  };

  // A prompt main refuses before the run starts (no model, no credentials)
  // shows its reason right away.
  const promptAgent = async (text: string) => {
    const response = await sendAgentCommand(applicationStatusStore.clusterId, { type: "prompt", message: text });
    if (!response.success) {
      applicationStatusStore.addMessage(getErrorMessage(response.error, { kind: "message", text }));
      applicationStatusStore.setLoading(false);
      return;
    }
    clearSpinnerUnlessStarted(response);
  };

  // AI Explain runs in main as a one-shot pi call with no tools. Its answer
  // streams back like a chat answer, but is not saved into the cluster's chat
  // session.
  const explainEvent = async (text: string) => {
    const response = await sendAgentCommand(applicationStatusStore.clusterId, { type: "explain", message: text });
    if (!response.success) {
      applicationStatusStore.addMessage(
        getErrorMessage(`Error in AI analysis: ${response.error}`, { kind: "explain", text }),
      );
      applicationStatusStore.setLoading(false);
      return;
    }
    clearSpinnerUnlessStarted(response);
  };

  // Answers an approval card. The card itself changes when main broadcasts the
  // result; an answer main no longer waits for (the run was stopped meanwhile)
  // is only logged.
  const answerApproval = async (approvalId: string, confirmed: boolean, approveAll = false) => {
    const response = await answerApprovalInMain(applicationStatusStore.clusterId, approvalId, confirmed, approveAll);
    if (!response.success) {
      log.error("The approval answer was not accepted: ", response.error);
    }
  };

  return { sendMessageToAgent, answerApproval, retry };
};

export default useChatService;
