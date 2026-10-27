import { describe, expect, it } from "vitest";
import { MessageType } from "../../../common/objects/message-type";
import {
  APPROVE_ALL_OPTION,
  type ChatViewState,
  chatFromSnapshot,
  reconcileApprovals,
  reduceEnvelope,
} from "./chat-reducer";

import type {
  AgentEnvelope,
  AgentSnapshot,
  ApprovalRequest,
  ChatMessage,
  SessionStats,
} from "../../../common/agent-protocol";
import type { MessageObject } from "../../../common/objects/message-object";

const userMessage: MessageObject = {
  messageId: "u1",
  type: "message" as MessageObject["type"],
  text: "hi",
  sent: true,
};

const initial = (messages: MessageObject[] = [userMessage]): ChatViewState => ({
  clusterId: "c1",
  seq: 0,
  messages,
  isRunning: false,
  autoApprove: false,
});

// Builds a recorded envelope stream for one cluster, numbering seq in order.
const stream = (clusterId: string, payloads: unknown[], firstSeq = 1): AgentEnvelope[] =>
  payloads.map(
    (payload, index) =>
      ({ clusterId, sessionId: "s1", seq: firstSeq + index, kind: "event", payload }) as unknown as AgentEnvelope,
  );

const assistantStart = { type: "message_start", message: { role: "assistant", content: [] } };
const assistantEnd = (extra: Record<string, unknown> = {}) => ({
  type: "message_end",
  message: { role: "assistant", content: [], stopReason: "stop", ...extra },
});
const textDelta = (delta: string) => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
const thinkingDelta = (delta: string) => ({
  type: "message_update",
  assistantMessageEvent: { type: "thinking_delta", delta },
});

const reduceAll = (state: ChatViewState, envelopes: AgentEnvelope[]) => envelopes.reduce(reduceEnvelope, state);
const agentTexts = (state: ChatViewState) =>
  state.messages.filter((m) => !m.sent && m.type !== MessageType.TOOL_CALL).map((m) => m.text);
const toolCalls = (state: ChatViewState) => state.messages.flatMap((m) => (m.toolCall ? [m.toolCall] : []));
const toolStart = (toolCallId: string, toolName: string, args: unknown) => ({
  type: "tool_execution_start",
  toolCallId,
  toolName,
  args,
});
const toolEnd = (toolCallId: string, toolName: string, text: string, isError = false) => ({
  type: "tool_execution_end",
  toolCallId,
  toolName,
  result: { content: [{ type: "text", text }], details: {} },
  isError,
});

describe("reduceEnvelope", () => {
  it("streams text deltas into one agent message after the user's message", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [
        { type: "agent_start" },
        assistantStart,
        textDelta("The cluster "),
        textDelta("runs v1.31.2."),
        assistantEnd(),
      ]),
    );

    expect(agentTexts(state)).toEqual(["The cluster runs v1.31.2."]);
    expect(state.messages[0]).toBe(userMessage);
    expect(state.seq).toBe(5);
    expect(state.messages.every((m) => !m.streaming)).toBe(true);
  });

  it("puts reasoning in the message's reasoning field", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [assistantStart, thinkingDelta("Check the version."), textDelta("v1"), assistantEnd()]),
    );

    expect(state.messages[1]).toMatchObject({ reasoning: "Check the version.", text: "v1", sent: false });
  });

  it("keeps the text before and after a tool call in separate messages, without empty ones", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [
        assistantStart,
        textDelta("Let me check."),
        assistantEnd({ stopReason: "toolUse" }),
        toolStart("t1", "getClusterVersion", {}),
        toolEnd("t1", "getClusterVersion", "v1.31.2"),
        assistantStart,
        assistantEnd({ stopReason: "toolUse" }),
        assistantStart,
        textDelta("It runs v1.31.2."),
        assistantEnd(),
      ]),
    );

    expect(agentTexts(state)).toEqual(["Let me check.", "It runs v1.31.2."]);
  });

  it("shows a tool call with its arguments after the text before it, running until its result arrives", () => {
    const running = reduceAll(
      initial(),
      stream("c1", [
        { type: "agent_start" },
        assistantStart,
        textDelta("Let me look."),
        assistantEnd({ stopReason: "toolUse" }),
        toolStart("t1", "getNamespaces", { label: "team=web" }),
      ]),
    );

    expect(running.messages.slice(1).map((m) => m.type)).toEqual([MessageType.MESSAGE, MessageType.TOOL_CALL]);
    expect(toolCalls(running)).toEqual([
      { toolCallId: "t1", toolName: "getNamespaces", args: { label: "team=web" }, running: true },
    ]);

    const [end] = stream("c1", [toolEnd("t1", "getNamespaces", "default\nweb")], 6);
    expect(toolCalls(reduceEnvelope(running, end!))).toEqual([
      {
        toolCallId: "t1",
        toolName: "getNamespaces",
        args: { label: "team=web" },
        running: false,
        result: "default\nweb",
        isError: false,
      },
    ]);
  });

  it("shows a failed tool call with its error text", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [
        toolStart("t1", "getClusterVersion", {}),
        toolEnd("t1", "getClusterVersion", "Cluster not connected", true),
      ]),
    );

    expect(toolCalls(state)).toEqual([
      expect.objectContaining({ running: false, result: "Cluster not connected", isError: true }),
    ]);
  });

  it("shows each of several tool calls once, with its own result", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [
        toolStart("t1", "getNamespaces", {}),
        toolStart("t2", "getClusterVersion", {}),
        toolEnd("t2", "getClusterVersion", "v1.31.2"),
        toolEnd("t1", "getNamespaces", "default"),
      ]),
    );

    expect(toolCalls(state).map((call) => [call.toolCallId, call.result])).toEqual([
      ["t1", "default"],
      ["t2", "v1.31.2"],
    ]);
  });

  it("stops showing a call as running when the run settles without its result", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [{ type: "agent_start" }, toolStart("t1", "getClusterVersion", {}), { type: "agent_settled" }]),
    );

    expect(toolCalls(state)).toEqual([{ toolCallId: "t1", toolName: "getClusterVersion", args: {}, running: false }]);
  });

  it("ignores envelopes for other clusters", () => {
    const before = initial();
    const after = reduceAll(before, stream("c2", [assistantStart, textDelta("not mine"), assistantEnd()]));

    expect(after).toBe(before);
  });

  it("ignores envelopes it already applied", () => {
    const envelopes = stream("c1", [assistantStart, textDelta("on"), textDelta("ce")]);
    const state = reduceAll(reduceAll(initial(), envelopes), envelopes.slice(1));

    expect(agentTexts(state)).toEqual(["once"]);
  });

  it("starts counting again when main restarts and sends seq 1", () => {
    const first = reduceAll(initial(), stream("c1", [assistantStart, textDelta("before"), assistantEnd()]));
    const restarted = reduceAll(first, stream("c1", [assistantStart, textDelta("after"), assistantEnd()]));

    expect(agentTexts(restarted)).toEqual(["before", "after"]);
    expect(restarted.seq).toBe(3);
  });

  it("ignores system and user messages from pi", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [
        { type: "message_start", message: { role: "system", content: "prompt" } },
        { type: "message_end", message: { role: "system", content: "prompt" } },
        { type: "message_start", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
        { type: "message_end", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
      ]),
    );

    expect(state.messages).toEqual([userMessage]);
  });

  it("shows a provider error as an error message that retries the user's prompt", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [assistantStart, assistantEnd({ stopReason: "error", errorMessage: "401 invalid_api_key" })]),
    );

    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({
      error: true,
      sent: false,
      retryContext: { kind: "message", text: "hi" },
    });
    expect(state.messages[1]?.text).toContain("401 invalid_api_key");
  });

  it("retries a failed AI Explain as an explanation, not as a chat prompt", () => {
    const explain: MessageObject = { messageId: "e1", type: MessageType.EXPLAIN, text: "explain this", sent: true };
    const state = reduceAll(
      initial([userMessage, explain]),
      stream("c1", [assistantStart, assistantEnd({ stopReason: "error", errorMessage: "503" })]),
    );

    expect(state.messages[2]).toMatchObject({ error: true, retryContext: { kind: "explain", text: "explain this" } });
  });
});

describe("run state", () => {
  it("is running from agent_start until agent_settled", () => {
    const [start, settled] = stream("c1", [{ type: "agent_start" }, { type: "agent_settled" }]);
    const running = reduceEnvelope(initial(), start!);
    expect(running.isRunning).toBe(true);
    expect(reduceEnvelope(running, settled!).isRunning).toBe(false);
  });

  it("ignores another cluster's run", () => {
    const [start] = stream("c2", [{ type: "agent_start" }]);
    expect(reduceEnvelope(initial(), start!).isRunning).toBe(false);
  });

  it("shows a stopped run as a notice after its partial answer", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [assistantStart, textDelta("Half an ans"), assistantEnd({ stopReason: "aborted" })]),
    );

    expect(state.messages.slice(1).map((m) => [m.text, !!m.notice, !!m.error])).toEqual([
      ["Half an ans", false, false],
      ["Stopped.", true, false],
    ]);
  });

  it("turns a provider error that pi retries into a retry notice instead of an error", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [
        assistantStart,
        assistantEnd({ stopReason: "error", errorMessage: "503 overloaded" }),
        { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "503 overloaded" },
        { type: "auto_retry_end", success: true, attempt: 1 },
        assistantStart,
        textDelta("Recovered."),
        assistantEnd(),
      ]),
    );

    const agent = state.messages.slice(1);
    expect(agent.some((m) => m.error)).toBe(false);
    expect(agent[0]).toMatchObject({ notice: true });
    expect(agent[0]?.text).toBe("Provider error: 503 overloaded. Retrying in 2 s (attempt 1 of 3).");
    expect(agent[1]?.text).toBe("Recovered.");
  });

  it("shows the final error with Retry when pi's retries run out", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [
        { type: "auto_retry_start", attempt: 3, maxAttempts: 3, delayMs: 8000, errorMessage: "503" },
        assistantStart,
        assistantEnd({ stopReason: "error", errorMessage: "503" }),
        { type: "auto_retry_end", success: false, attempt: 3, finalError: "503" },
      ]),
    );

    expect(state.messages[state.messages.length - 1]).toMatchObject({ error: true });
  });
});

describe("seq gaps", () => {
  it("marks the state stale when envelopes were missed, so the frame asks for a snapshot", () => {
    const state = reduceAll(initial(), stream("c1", [assistantStart, textDelta("a")]));
    const [late] = stream("c1", [textDelta("z")], 7);

    expect(state.stale).toBeFalsy();
    expect(reduceEnvelope(state, late!).stale).toBe(true);
  });
});

describe("chatFromSnapshot", () => {
  const user = (text: string) => ({ role: "user", content: text, timestamp: 1 }) as ChatMessage;
  const assistant = (content: unknown[], extra: Record<string, unknown> = {}) =>
    ({ role: "assistant", content, stopReason: "stop", ...extra }) as unknown as ChatMessage;

  const snapshot = (overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
    messages: [],
    isStreaming: false,
    autoApprove: false,
    seq: 0,
    ...overrides,
  });

  const toolResult = (toolCallId: string, text: string, isError = false) =>
    ({
      role: "toolResult",
      toolCallId,
      toolName: "getClusterVersion",
      content: [{ type: "text", text }],
      isError,
      timestamp: 1,
    }) as ChatMessage;

  it("rebuilds the saved transcript with each tool call and its result", () => {
    const state = chatFromSnapshot(
      "c1",
      snapshot({
        seq: 12,
        messages: [
          user("which version?"),
          assistant([{ type: "toolCall", id: "t1", name: "getClusterVersion", arguments: {} }], {
            stopReason: "toolUse",
          }),
          toolResult("t1", "v1.31.2"),
          assistant([
            { type: "thinking", thinking: "Read the result." },
            { type: "text", text: "It runs v1.31.2." },
          ]),
        ],
      }),
    );

    expect(state.seq).toBe(12);
    expect(state.isRunning).toBe(false);
    expect(state.messages.map((m) => ({ text: m.text, sent: m.sent, reasoning: m.reasoning }))).toEqual([
      { text: "which version?", sent: true, reasoning: undefined },
      { text: "", sent: false, reasoning: undefined },
      { text: "It runs v1.31.2.", sent: false, reasoning: "Read the result." },
    ]);
    expect(toolCalls(state)).toEqual([
      { toolCallId: "t1", toolName: "getClusterVersion", args: {}, running: false, result: "v1.31.2", isError: false },
    ]);
  });

  it("shows a call without a result as running only while the run goes on", () => {
    const messages = [
      user("which version?"),
      assistant([{ type: "toolCall", id: "t1", name: "getClusterVersion", arguments: {} }], { stopReason: "toolUse" }),
    ];

    expect(toolCalls(chatFromSnapshot("c1", snapshot({ messages, isStreaming: true })))).toEqual([
      { toolCallId: "t1", toolName: "getClusterVersion", args: {}, running: true },
    ]);
    expect(toolCalls(chatFromSnapshot("c1", snapshot({ messages, isStreaming: false })))).toEqual([
      { toolCallId: "t1", toolName: "getClusterVersion", args: {}, running: false },
    ]);
  });

  it("leaves out the tool calls of an answer that failed or was stopped, which pi never runs", () => {
    const state = chatFromSnapshot(
      "c1",
      snapshot({
        messages: [
          user("hi"),
          assistant([{ type: "toolCall", id: "t1", name: "getClusterVersion", arguments: {} }], {
            stopReason: "aborted",
          }),
        ],
      }),
    );

    expect(toolCalls(state)).toEqual([]);
    expect(state.messages.map((m) => m.text)).toEqual(["hi", "Stopped."]);
  });

  it("reads a user message given as text parts", () => {
    const state = chatFromSnapshot(
      "c1",
      snapshot({
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 } as ChatMessage],
      }),
    );
    expect(state.messages[0]).toMatchObject({ text: "hello", sent: true });
  });

  it("keeps saved errors and stops visible", () => {
    const state = chatFromSnapshot(
      "c1",
      snapshot({
        messages: [
          user("hi"),
          assistant([], { stopReason: "error", errorMessage: "401 invalid_api_key" }),
          user("again"),
          assistant([{ type: "text", text: "Part" }], { stopReason: "aborted" }),
        ],
      }),
    );

    expect(state.messages.map((m) => [m.text, !!m.error, !!m.notice])).toEqual([
      ["hi", false, false],
      ["Error while running Freelens Agent: 401 invalid_api_key", true, false],
      ["again", false, false],
      ["Part", false, false],
      ["Stopped.", false, true],
    ]);
    expect(state.messages[1]?.retryContext).toEqual({ kind: "message", text: "hi" });
  });

  it("continues a remount mid-stream from the partial answer and later envelopes", () => {
    const remounted = chatFromSnapshot(
      "c1",
      snapshot({
        seq: 4,
        isStreaming: true,
        messages: [user("tell me a story")],
        streamingMessage: assistant([{ type: "text", text: "Once upon" }], { stopReason: "pending" }) as never,
      }),
    );
    expect(remounted.isRunning).toBe(true);

    // Seq 4 is already part of the snapshot's partial answer.
    const state = reduceAll(remounted, stream("c1", [textDelta(" upon"), textDelta(" a time."), assistantEnd()], 4));

    expect(agentTexts(state)).toEqual(["Once upon a time."]);
    expect(state.messages.every((m) => !m.streaming)).toBe(true);
  });
});

describe("approvals", () => {
  const request: ApprovalRequest = {
    id: "a1",
    toolCallId: "t1",
    method: "confirm",
    title: "PATCH DEPLOYMENT",
    message: "action: PATCH DEPLOYMENT\nname: web\n",
    approval: { tool: "patchKubernetesResource", kind: "Deployment", apiVersion: "apps/v1", name: "web" },
  };
  const envelope = (seq: number, kind: string, payload: unknown) =>
    ({ clusterId: "c1", sessionId: "s1", seq, kind, payload }) as unknown as AgentEnvelope;
  const card = (state: ChatViewState) => state.messages.find((m) => m.approvalId === "a1");

  it("shows a pending approval card with the action YAML", () => {
    const state = reduceEnvelope(initial(), envelope(1, "ui_request", request));

    expect(card(state)).toMatchObject({
      type: MessageType.INTERRUPT,
      action: "PATCH DEPLOYMENT",
      actionDetails: "action: PATCH DEPLOYMENT\nname: web\n",
      approved: null,
      sent: false,
    });
    expect(card(state)?.resources).toBeUndefined();
    expect(state.seq).toBe(1);
  });

  it("shows the backup that came with the request", () => {
    const state = reduceEnvelope(initial(), envelope(1, "ui_request", { ...request, backup: "kind: Deployment\n" }));

    expect(card(state)?.resources).toBe("kind: Deployment\n");
  });

  it("marks the card approved or denied when main settles it", () => {
    const pending = reduceEnvelope(initial(), envelope(1, "ui_request", request));
    const settle = (confirmed: boolean) =>
      card(reduceEnvelope(pending, envelope(2, "ui_resolved", { id: "a1", confirmed })))?.approved;

    expect(settle(true)).toBe(true);
    expect(settle(false)).toBe(false);
  });

  it("brings a pending approval back from the snapshot, with its backup", () => {
    const state = chatFromSnapshot("c1", {
      messages: [{ role: "user", content: "scale web", timestamp: 1 } as ChatMessage],
      isStreaming: true,
      pendingUiRequest: { ...request, backup: "kind: Deployment\n" },
      autoApprove: false,
      seq: 7,
    });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]?.text).toBe("scale web");
    expect(card(state)).toMatchObject({ approved: null, resources: "kind: Deployment\n" });
  });

  it("after a snapshot, closes the cards main no longer waits on and keeps the pending one", () => {
    const before = reduceEnvelope(
      reduceEnvelope(initial(), envelope(1, "ui_request", { ...request, id: "old" })),
      envelope(2, "ui_request", request),
    );

    expect(reconcileApprovals(before, "a1").messages.find((m) => m.approvalId === "old")).toMatchObject({
      approved: false,
    });
    expect(card(reconcileApprovals(before, "a1"))?.approved).toBeNull();
    expect(card(reconcileApprovals(before, undefined))?.approved).toBe(false);
  });

  it("offers approving all in this chat as a third answer", () => {
    const state = reduceEnvelope(initial(), envelope(1, "ui_request", request));
    expect(card(state)?.options).toEqual(["yes", "no", APPROVE_ALL_OPTION]);
  });
});

describe("approve all in this chat", () => {
  const autoApprove = (seq: number, enabled: boolean, clusterId = "c1") =>
    ({ clusterId, sessionId: "s1", seq, kind: "auto_approve", payload: { enabled } }) as AgentEnvelope;

  it("follows main turning it on and off", () => {
    const on = reduceEnvelope(initial(), autoApprove(1, true));
    expect(on.autoApprove).toBe(true);
    expect(on.messages).toEqual([userMessage]);
    expect(reduceEnvelope(on, autoApprove(2, false)).autoApprove).toBe(false);
  });

  it("ignores another cluster's setting", () => {
    expect(reduceEnvelope(initial(), autoApprove(1, true, "c2")).autoApprove).toBe(false);
  });

  it("comes back from the snapshot after a remount", () => {
    const snapshot: AgentSnapshot = {
      messages: [],
      isStreaming: false,
      autoApprove: true,
      seq: 3,
    };
    expect(chatFromSnapshot("c1", snapshot).autoApprove).toBe(true);
    expect(chatFromSnapshot("c1", { ...snapshot, autoApprove: false }).autoApprove).toBe(false);
  });
});

describe("session stats", () => {
  const stats = (output: number): SessionStats => ({
    sessionFile: undefined,
    sessionId: "s1",
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 2,
    tokens: { input: 1200, output, cacheRead: 300, cacheWrite: 0, total: 1500 + output },
    cost: 0.0042,
    contextUsage: { tokens: 1500, contextWindow: 272_000, percent: 0.55 },
  });
  const statsEnvelope = (clusterId: string, seq: number, payload: SessionStats) =>
    ({ clusterId, sessionId: "s1", seq, kind: "stats", payload }) as AgentEnvelope;

  it("keeps the latest stats from main without touching the transcript", () => {
    const state = reduceAll(initial(), [statsEnvelope("c1", 1, stats(10)), statsEnvelope("c1", 2, stats(25))]);

    expect(state.stats).toEqual(stats(25));
    expect(state.messages).toEqual([userMessage]);
    expect(state.seq).toBe(2);
  });

  it("ignores another cluster's stats", () => {
    const state = reduceEnvelope(initial(), statsEnvelope("c2", 1, stats(10)));
    expect(state.stats).toBeUndefined();
  });

  it("takes the stats from a snapshot", () => {
    const snapshot: AgentSnapshot = {
      messages: [],
      isStreaming: false,
      autoApprove: false,
      stats: stats(40),
      seq: 3,
    };
    expect(chatFromSnapshot("c1", snapshot).stats).toEqual(stats(40));
  });
});

describe("compaction", () => {
  const compactionEnd = (extra: Record<string, unknown> = {}) => ({
    type: "compaction_end",
    reason: "threshold",
    result: { summary: "..." },
    aborted: false,
    willRetry: false,
    ...extra,
  });
  const notices = (state: ChatViewState) => state.messages.filter((m) => m.notice).map((m) => m.text);
  const compacted = "Compacted the conversation: earlier messages were summarized to free up context.";

  it("shows a line while pi compacts and replaces it with the outcome", () => {
    const compacting = reduceAll(initial(), stream("c1", [{ type: "compaction_start", reason: "threshold" }]));
    expect(notices(compacting)).toEqual(["Compacting the conversation to free up context..."]);

    const done = reduceEnvelope(compacting, stream("c1", [compactionEnd()], 2)[0]!);
    expect(notices(done)).toEqual([compacted]);
    expect(done.messages).toHaveLength(2);
  });

  it("keeps the compaction line in place while the answer streams after it", () => {
    const state = reduceAll(
      initial(),
      stream("c1", [
        { type: "compaction_start", reason: "overflow" },
        compactionEnd({ reason: "overflow", willRetry: true }),
        assistantStart,
        textDelta("Retried."),
        assistantEnd(),
      ]),
    );

    expect(state.messages.map((m) => m.text)).toEqual(["hi", compacted, "Retried."]);
  });

  it("rebuilds the compaction line from a snapshot, in place", () => {
    const snapshot: AgentSnapshot = {
      messages: [
        { role: "user", content: "hi", timestamp: 1 },
        { role: "assistant", content: [{ type: "text", text: "first" }], stopReason: "stop" } as ChatMessage,
        { role: "compaction", timestamp: 3 },
        { role: "user", content: "again", timestamp: 4 },
      ],
      isStreaming: false,
      autoApprove: false,
      seq: 9,
    };

    const state = chatFromSnapshot("c1", snapshot);
    expect(state.messages.map((m) => m.text)).toEqual(["hi", "first", compacted, "again"]);
    expect(state.messages[2]).toMatchObject({ notice: true, sent: false });
  });

  it("says when a compaction failed or was stopped", () => {
    const failed = reduceAll(
      initial(),
      stream("c1", [
        { type: "compaction_start", reason: "threshold" },
        compactionEnd({ result: undefined, errorMessage: "context too small" }),
      ]),
    );
    expect(notices(failed)).toEqual(["Compacting the conversation failed: context too small"]);

    const stopped = reduceAll(
      initial(),
      stream("c1", [
        { type: "compaction_start", reason: "manual" },
        compactionEnd({ result: undefined, aborted: true }),
      ]),
    );
    expect(notices(stopped)).toEqual(["Compacting the conversation was stopped."]);
  });
});
