import {
  type AgentRunEvent,
  type AgentRunInput,
  BridgeErrorCode,
  BridgeRoute,
  type ExplainEvent,
} from "../../../common/bridge/protocol";
import { MessageType } from "../../../common/objects/message-type";
import { approximateTokenCount } from "../../../common/provider/token-estimate";
import { estimateNextPromptTokens, shouldCompactSession } from "../../../common/service/session-compaction";
import { useApplicationStatusStore } from "../../context/application-context";
import useLog from "../../utils/logger/logger-service";
import { streamFromBridge } from "../bridge/bridge-client";
import { getErrorMessage, getExplainMessage, getInterruptMessage } from "../objects/message-object-provider";

import type { MessageObject, RetryContext } from "../../../common/objects/message-object";

// The message of an error of the bridge or of a run. Main already words the
// errors of the model endpoint; see src/main/agents/describe-error.ts.
const getReadableErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const useChatService = () => {
  const { log } = useLog("useChatService");
  const applicationStatusStore = useApplicationStatusStore();

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
          runAgent({ kind: "resume", answer: message.text }, { kind: "resume", text: message.text }).finally(() => {
            applicationStatusStore.setLoading(false);
          });
        } else {
          _sendMessage(message);
          // Compact the session first when the next prompt would approach the
          // model's input token limit, then send (seeding the summary into the
          // prompt so the conversation context is not lost).
          (async () => {
            const summary = await _maybeCompactBeforeSend(message.text);
            await runAgent({ kind: "message", text: message.text, summary }, { kind: "message", text: message.text });
          })().finally(() => applicationStatusStore.setLoading(false));
        }
      } else {
        log.error("You cannot call sendMessageToAgent with 'sent: false'");
      }
    } catch {
      applicationStatusStore.setLoading(false);
    }
  };

  // Estimate the next prompt's input tokens from the previous response and the
  // new message, and compact the session first when that reaches the threshold
  // (90%) of the selected model's max input tokens. Returns the summary to seed
  // into the next prompt, or null when no compaction was needed or possible.
  const _maybeCompactBeforeSend = async (text: string): Promise<string | null> => {
    const estimate = estimateNextPromptTokens(applicationStatusStore.lastInputTokens, approximateTokenCount(text));
    if (!shouldCompactSession(estimate, applicationStatusStore.getMaxInputTokens())) {
      return null;
    }
    log.debug("Next prompt approaches the input token limit, compacting session first");
    return applicationStatusStore.compactSession();
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
      analyzeEvent(getExplainMessage(retryContext.text)).finally(() => applicationStatusStore.setLoading(false));
    } else if (retryContext.kind === "resume") {
      runAgent({ kind: "resume", answer: retryContext.text }, retryContext).finally(() =>
        applicationStatusStore.setLoading(false),
      );
    } else {
      runAgent({ kind: "message", text: retryContext.text }, retryContext).finally(() =>
        applicationStatusStore.setLoading(false),
      );
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
      runAgent({ kind: "resume", answer: option }, { kind: "resume", text: option }).finally(() => {
        applicationStatusStore.setLoading(false);
      });
    } catch {
      applicationStatusStore.setLoading(false);
    }
  };

  const changeInterruptStatus = (id: string, status: boolean) => {
    applicationStatusStore.changeInterruptStatus(id, status);
  };

  const analyzeEvent = async (lastMessage: MessageObject) => {
    try {
      const events = streamFromBridge<ExplainEvent>(BridgeRoute.explain, {
        clusterId: applicationStatusStore.clusterId,
        text: lastMessage.text,
      });
      for await (const event of events) {
        if (event.type === "text") {
          applicationStatusStore.updateLastMessage(event.text);
        } else if (event.type === "error") {
          throw new Error(event.error.message);
        }
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

  const runAgent = async (input: AgentRunInput, retryContext: RetryContext) => {
    try {
      const events = streamFromBridge<AgentRunEvent>(BridgeRoute.run, {
        clusterId: applicationStatusStore.clusterId,
        conversationId: applicationStatusStore.conversationId,
        input,
      });
      let endedWithInterrupt = false;
      let autoApproveAndResume = false;
      for await (const event of events) {
        switch (event.type) {
          case "text":
            applicationStatusStore.updateLastMessage(event.text);
            break;
          // Reasoning deltas update the message's separate reasoning field
          // rather than its visible answer text.
          case "reasoning":
            applicationStatusStore.updateLastMessageReasoning(event.reasoning);
            break;
          // Token usage deltas are summed into the per-session counter (and the
          // cost derived from it) shown next to the model list. Emitted live per
          // completed LLM call, so the counter and cost move during a turn; a
          // negative delta on a transient-error retry rolls back the failed
          // attempt's contribution.
          case "usage":
            applicationStatusStore.addTokenUsage(event.tokenUsage);
            break;
          // Persisted-context size: record what the next prompt re-sends so the
          // next send can decide whether to compact before reaching the model's
          // input token limit, and update the capacity indicator live. The peak
          // is kept only for the indicator tooltip.
          case "context":
            applicationStatusStore.setLastInputTokens(event.contextTokens);
            applicationStatusStore.setLastPeakInputTokens(event.peakInputTokens);
            break;
          case "interrupt": {
            log.debug("Approval interrupt received: ", event.value);
            const interruptMessage = getInterruptMessage(event.value, false);
            if (applicationStatusStore.bypassApprovals) {
              log.debug("Bypass approvals mode enabled: auto-approving tool use");
              interruptMessage.approved = true;
              autoApproveAndResume = true;
            } else {
              endedWithInterrupt = true;
            }
            _sendMessage(interruptMessage);
            break;
          }
          case "error":
            if (event.error.code === BridgeErrorCode.noPendingApproval) {
              // Main has no approval to answer, after a clear for one: the
              // next message is a new prompt, and a retry of this answer would
              // be refused the same way, so the error offers none.
              log.warn("No pending approval to answer, the next message is a new prompt");
              applicationStatusStore.setConversationInterrupted(false);
              _sendMessage(getErrorMessage(`Error while running Freelens Agent: ${event.error.message}`));
              return;
            }
            throw new Error(event.error.message);
          case "done":
            break;
        }
      }
      applicationStatusStore.setConversationInterrupted(endedWithInterrupt);
      if (autoApproveAndResume) {
        await runAgent({ kind: "resume", answer: "yes" }, retryContext);
      }
    } catch (error) {
      log.error("Error while running Freelens Agent: ", error);

      _sendMessage(
        getErrorMessage(`Error while running Freelens Agent: ${getReadableErrorMessage(error)}`, retryContext),
      );
    }
  };

  return { sendMessageToAgent, resumeInterrupt, changeInterruptStatus, retry };
};

export default useChatService;
