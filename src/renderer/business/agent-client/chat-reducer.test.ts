import { describe, expect, it } from "vitest";
import { MessageType } from "../objects/message-type";
import { type ChatViewState, chatFromSnapshot, reduceEnvelope, withApprovalBackup } from "./chat-reducer";

import type { AgentEnvelope, AgentSnapshot, ApprovalRequest, ChatMessage } from "../../../common/agent-protocol";
import type { MessageObject } from "../objects/message-object";

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
const agentTexts = (state: ChatViewState) => state.messages.filter((m) => !m.sent).map((m) => m.text);

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
        { type: "tool_execution_start", toolCallId: "t1", toolName: "getClusterVersion", args: {} },
        { type: "tool_execution_end", toolCallId: "t1", toolName: "getClusterVersion", isError: false },
        assistantStart,
        assistantEnd({ stopReason: "toolUse" }),
        assistantStart,
        textDelta("It runs v1.31.2."),
        assistantEnd(),
      ]),
    );

    expect(agentTexts(state)).toEqual(["Let me check.", "It runs v1.31.2."]);
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

  it("drops tool requests: the tool runner handles those", () => {
    const before = initial();
    const after = reduceEnvelope(before, {
      clusterId: "c1",
      sessionId: "s1",
      seq: 1,
      kind: "tool_request",
      payload: { requestId: "r1", toolName: "getClusterVersion", args: {} },
    });

    expect(after.messages).toBe(before.messages);
    expect(after.seq).toBe(1);
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
    pendingToolRequests: [],
    autoApprove: false,
    seq: 0,
    ...overrides,
  });

  it("rebuilds the saved transcript, skipping turns with only tool calls", () => {
    const state = chatFromSnapshot(
      "c1",
      snapshot({
        seq: 12,
        messages: [
          user("which version?"),
          assistant([{ type: "toolCall", id: "t1", name: "getClusterVersion", arguments: {} }], {
            stopReason: "toolUse",
          }),
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
      { text: "It runs v1.31.2.", sent: false, reasoning: "Read the result." },
    ]);
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
      approvalTarget: request.approval,
      sent: false,
    });
    expect(state.seq).toBe(1);
  });

  it("marks the card approved or denied when main settles it", () => {
    const pending = reduceEnvelope(initial(), envelope(1, "ui_request", request));
    const settle = (confirmed: boolean) =>
      card(reduceEnvelope(pending, envelope(2, "ui_resolved", { id: "a1", confirmed })))?.approved;

    expect(settle(true)).toBe(true);
    expect(settle(false)).toBe(false);
  });

  it("brings a pending approval back from the snapshot", () => {
    const state = chatFromSnapshot("c1", {
      messages: [{ role: "user", content: "scale web", timestamp: 1 } as ChatMessage],
      isStreaming: true,
      pendingToolRequests: [],
      pendingUiRequest: request,
      autoApprove: false,
      seq: 7,
    });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]?.text).toBe("scale web");
    expect(card(state)?.approved).toBeNull();
  });

  it("adds the current resource as a backup once the frame has loaded it", () => {
    const pending = reduceEnvelope(initial(), envelope(1, "ui_request", request));
    const state = withApprovalBackup(pending, "a1", "kind: Deployment\n");

    expect(card(state)?.resources).toBe("kind: Deployment\n");
    expect(withApprovalBackup(state, "other", "x")).toBe(state);
  });
});
