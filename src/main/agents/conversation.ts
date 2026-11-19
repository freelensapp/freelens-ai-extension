// The stored conversation of an agent: a list of AI SDK model messages, plain
// JSON, which main keeps in `AgentStateStore` and re-sends with every request.
// Pure helpers, unit-tested directly.

import { approximateTokenCount } from "../../common/provider/token-estimate";

import type { ModelMessage, ToolApprovalResponse, ToolContent } from "ai";

import type { AgentRunInput, ApprovalRequest } from "../../common/bridge/protocol";
import type { HistoryMessageLike } from "../../common/service/session-compaction";

// The number of user turns kept in the stored conversation; an older turn,
// with its tool calls and results, is dropped when a new prompt is added.
export const HISTORY_TURNS = 5;

// What a denied tool call reports to the model.
export const DENIED_REASON = "The user denied the action";

// A tool call of the conversation that waits on the user's approval.
export interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/**
 * The approvals of the conversation that have no answer: approval requests of
 * the assistant without a response in a later tool message. A conversation
 * whose last run ended with an approval request has them, also after a restart,
 * since the requests are part of the stored messages.
 */
export const findPendingApprovals = (messages: readonly ModelMessage[]): PendingApproval[] => {
  const toolCalls = new Map<string, { toolName: string; input: unknown }>();
  const requests: { approvalId: string; toolCallId: string }[] = [];
  const answered = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant" && typeof message.content !== "string") {
      for (const part of message.content) {
        if (part.type === "tool-call") {
          toolCalls.set(part.toolCallId, { toolName: part.toolName, input: part.input });
        } else if (part.type === "tool-approval-request") {
          requests.push({ approvalId: part.approvalId, toolCallId: part.toolCallId });
        }
      }
    } else if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type === "tool-approval-response") {
          answered.add(part.approvalId);
        }
      }
    }
  }
  return requests
    .filter(({ approvalId }) => !answered.has(approvalId))
    .map(({ approvalId, toolCallId }) => ({
      approvalId,
      toolCallId,
      toolName: toolCalls.get(toolCallId)?.toolName ?? "",
      input: toolCalls.get(toolCallId)?.input,
    }));
};

// The conversation with a tool message for the given content: merged into the
// last message when it is a tool message, since the AI SDK reads the answers
// of the approvals from the last message only.
const withToolContent = (messages: readonly ModelMessage[], content: ToolContent): ModelMessage[] => {
  const last = messages.at(-1);
  if (last?.role === "tool") {
    return [...messages.slice(0, -1), { ...last, content: [...last.content, ...content] }];
  }
  return [...messages, { role: "tool", content }];
};

/**
 * The conversation with the answer of the user to every pending approval, which
 * the next run reads: an approved call runs, a denied one reports the denial to
 * the model.
 */
export const answerApprovals = (
  messages: readonly ModelMessage[],
  pending: readonly PendingApproval[],
  approved: boolean,
): ModelMessage[] =>
  withToolContent(
    messages,
    pending.map(
      ({ approvalId }): ToolApprovalResponse => ({
        type: "tool-approval-response",
        approvalId,
        approved,
        ...(approved ? {} : { reason: DENIED_REASON }),
      }),
    ),
  );

/**
 * The conversation with every pending approval denied and closed with a tool
 * result, for a new prompt that comes instead of an answer: a provider refuses
 * a tool call without a result, and the AI SDK reads the answers only from the
 * last message, which is the new prompt.
 */
export const closePendingApprovals = (messages: readonly ModelMessage[]): ModelMessage[] => {
  const pending = findPendingApprovals(messages);
  if (pending.length === 0) {
    return [...messages];
  }
  return withToolContent(
    messages,
    pending.flatMap(
      ({ approvalId, toolCallId, toolName }): ToolContent => [
        { type: "tool-approval-response", approvalId, approved: false, reason: DENIED_REASON },
        { type: "tool-result", toolCallId, toolName, output: { type: "execution-denied", reason: DENIED_REASON } },
      ],
    ),
  );
};

/**
 * The conversation from the start of its last `turns` user turns, so that a
 * tool call is never kept without its result.
 */
export const trimHistory = (messages: readonly ModelMessage[], turns = HISTORY_TURNS): ModelMessage[] => {
  let seen = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      seen += 1;
      if (seen === turns) {
        return messages.slice(index);
      }
    }
  }
  return [...messages];
};

/**
 * The user messages of a prompt. When the session was just compacted, the
 * summary comes first, so the agent keeps the earlier context although the
 * stored conversation was replaced.
 */
export const promptMessages = (input: Extract<AgentRunInput, { kind: "message" }>): ModelMessage[] => [
  ...(input.summary
    ? [{ role: "user" as const, content: `Summary of the earlier (compacted) conversation:\n${input.summary}` }]
    : []),
  { role: "user", content: input.text },
];

// The text of a part that the next request re-sends: the text, the input of a
// tool call and the output of a tool result. Reasoning is left out.
const partText = (part: { type: string } & Record<string, unknown>): string => {
  switch (part.type) {
    case "text":
      return typeof part.text === "string" ? part.text : "";
    case "tool-call":
      return JSON.stringify(part.input ?? {});
    case "tool-result": {
      const output = part.output as { type?: string; value?: unknown } | undefined;
      if (output?.value === undefined) {
        return "";
      }
      return typeof output.value === "string" ? output.value : JSON.stringify(output.value);
    }
    default:
      return "";
  }
};

export const messageText = (message: ModelMessage): string =>
  typeof message.content === "string"
    ? message.content
    : message.content.map((part) => partText(part as { type: string } & Record<string, unknown>)).join("");

/** The approximate token count of the conversation that the next request re-sends. */
export const approximateConversationTokens = (messages: readonly ModelMessage[]): number =>
  messages.reduce((sum, message) => sum + approximateTokenCount(messageText(message)), 0);

/** The conversation as plain-text turns, for the summary of a compaction. */
export const toHistoryMessages = (messages: readonly ModelMessage[]): HistoryMessageLike[] =>
  messages.map((message) => ({ role: message.role, content: messageText(message) }));

/**
 * One approval request for several calls, which one answer approves or denies
 * together: the bridge carries one approval per run.
 */
export const mergeApprovalRequests = (requests: readonly ApprovalRequest[]): ApprovalRequest => {
  if (requests.length === 1 && requests[0]) {
    return requests[0];
  }
  const joined = (values: (string | undefined)[], separator: string) => {
    const present = values.filter((value): value is string => Boolean(value));
    return present.length > 0 ? present.join(separator) : undefined;
  };
  return {
    question: "Do you want to approve these actions?",
    options: ["yes", "no"],
    actionToApprove: { action: requests.flatMap(({ actionToApprove }) => actionToApprove.action) },
    actionString: joined(
      requests.map(({ actionString }) => actionString),
      "---\n",
    ),
    resourcesString: joined(
      requests.map(({ resourcesString }) => resourcesString),
      "---\n",
    ),
    requestString: requests.map(({ requestString }) => requestString).join("\n\n"),
  };
};
