import { describe, expect, it } from "vitest";
import {
  answerApprovals,
  approximateConversationTokens,
  closePendingApprovals,
  DENIED_REASON,
  findPendingApprovals,
  mergeApprovalRequests,
  promptMessages,
  toHistoryMessages,
  trimHistory,
} from "./conversation";

import type { ModelMessage } from "ai";

import type { ApprovalRequest } from "../../common/bridge/protocol";

// A turn whose tool call waits on an approval, as the AI SDK stores it.
const waiting: ModelMessage[] = [
  { role: "user", content: "delete web" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Deleting." },
      { type: "tool-call", toolCallId: "call-1", toolName: "deleteKubernetesResource", input: { name: "web" } },
      { type: "tool-approval-request", approvalId: "approval-1", toolCallId: "call-1" },
    ],
  },
];

describe("findPendingApprovals", () => {
  it("finds an approval request without an answer, with its tool call", () => {
    expect(findPendingApprovals(waiting)).toEqual([
      { approvalId: "approval-1", toolCallId: "call-1", toolName: "deleteKubernetesResource", input: { name: "web" } },
    ]);
  });

  it("finds nothing once the approval is answered, or in a conversation without one", () => {
    expect(findPendingApprovals(answerApprovals(waiting, findPendingApprovals(waiting), true))).toEqual([]);
    expect(findPendingApprovals([{ role: "user", content: "hi" }])).toEqual([]);
    expect(findPendingApprovals([])).toEqual([]);
  });
});

describe("answerApprovals", () => {
  it("appends the answer as a tool message", () => {
    const answered = answerApprovals(waiting, findPendingApprovals(waiting), false);

    expect(answered.at(-1)).toEqual({
      role: "tool",
      content: [{ type: "tool-approval-response", approvalId: "approval-1", approved: false, reason: DENIED_REASON }],
    });
  });

  it("adds the answer to the last message when it is a tool message, which the AI SDK reads alone", () => {
    const withResult: ModelMessage[] = [
      ...waiting,
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "call-0", toolName: "getNamespaces", output: { type: "json", value: [] } },
        ],
      },
    ];

    const answered = answerApprovals(withResult, findPendingApprovals(withResult), true);

    expect(answered).toHaveLength(3);
    expect(answered.at(-1)?.content).toEqual([
      expect.objectContaining({ type: "tool-result", toolCallId: "call-0" }),
      { type: "tool-approval-response", approvalId: "approval-1", approved: true },
    ]);
  });
});

describe("closePendingApprovals", () => {
  it("denies a pending approval and closes its tool call with a result", () => {
    const closed = closePendingApprovals(waiting);

    expect(closed.at(-1)).toEqual({
      role: "tool",
      content: [
        { type: "tool-approval-response", approvalId: "approval-1", approved: false, reason: DENIED_REASON },
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "deleteKubernetesResource",
          output: { type: "execution-denied", reason: DENIED_REASON },
        },
      ],
    });
    expect(findPendingApprovals(closed)).toEqual([]);
  });

  it("leaves a conversation without a pending approval as it is", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "hi" }];
    expect(closePendingApprovals(messages)).toEqual(messages);
  });
});

describe("trimHistory", () => {
  const turns = (count: number): ModelMessage[] =>
    Array.from({ length: count }, (_, index): ModelMessage[] => [
      { role: "user", content: `turn ${index + 1}` },
      { role: "assistant", content: `answer ${index + 1}` },
    ]).flat();

  it("keeps the last turns from their user message, so a tool call keeps its result", () => {
    expect(trimHistory(turns(4), 2)).toEqual(turns(4).slice(4));
    expect(trimHistory([...waiting, ...turns(1)], 2)).toEqual([...waiting, ...turns(1)]);
  });

  it("keeps a shorter conversation as it is", () => {
    expect(trimHistory(turns(2), 5)).toEqual(turns(2));
  });
});

describe("promptMessages", () => {
  it("is the prompt, after the summary of a compacted session", () => {
    expect(promptMessages({ kind: "message", text: "hi" })).toEqual([{ role: "user", content: "hi" }]);
    expect(promptMessages({ kind: "message", text: "hi", summary: "earlier" })).toEqual([
      { role: "user", content: "Summary of the earlier (compacted) conversation:\nearlier" },
      { role: "user", content: "hi" },
    ]);
  });
});

describe("the text of a conversation", () => {
  const conversation: ModelMessage[] = [
    ...waiting,
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "deleteKubernetesResource",
          output: { type: "text", value: "deleted" },
        },
      ],
    },
  ];

  it("counts the text, the tool inputs and the tool outputs the next request re-sends", () => {
    // Per message: "delete web" (10 characters), "Deleting." with '{"name":"web"}'
    // (9 + 14) and "deleted" (7), at four characters per token, rounded up.
    expect(approximateConversationTokens(conversation)).toBe(3 + 6 + 2);
  });

  it("is a turn per message for the summary of a compaction", () => {
    expect(toHistoryMessages(conversation)).toEqual([
      { role: "user", content: "delete web" },
      { role: "assistant", content: 'Deleting.{"name":"web"}' },
      { role: "tool", content: "deleted" },
    ]);
  });
});

describe("mergeApprovalRequests", () => {
  const request = (action: string, backup?: string): ApprovalRequest => ({
    question: "Do you want to approve this action?",
    options: ["yes", "no"],
    actionToApprove: { action },
    actionString: `action: ${action}\n`,
    resourcesString: backup,
    requestString: `request ${action}`,
  });

  it("keeps a single request as it is", () => {
    const single = request("DELETE POD");
    expect(mergeApprovalRequests([single])).toBe(single);
  });

  it("joins several requests into one that one answer approves", () => {
    expect(mergeApprovalRequests([request("DELETE POD", "pod: a\n"), request("RESTART DEPLOYMENT")])).toEqual({
      question: "Do you want to approve these actions?",
      options: ["yes", "no"],
      actionToApprove: { action: ["DELETE POD", "RESTART DEPLOYMENT"] },
      actionString: "action: DELETE POD\n---\naction: RESTART DEPLOYMENT\n",
      resourcesString: "pod: a\n",
      requestString: "request DELETE POD\n\nrequest RESTART DEPLOYMENT",
    });
  });
});
