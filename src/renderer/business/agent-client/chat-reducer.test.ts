import { describe, expect, it } from "vitest";
import { type ChatViewState, isRunEnd, reduceEnvelope } from "./chat-reducer";

import type { AgentEnvelope } from "../../../common/agent-protocol";
import type { MessageObject } from "../objects/message-object";

const userMessage: MessageObject = {
  messageId: "u1",
  type: "message" as MessageObject["type"],
  text: "hi",
  sent: true,
};

const initial = (messages: MessageObject[] = [userMessage]): ChatViewState => ({ clusterId: "c1", seq: 0, messages });

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

describe("isRunEnd", () => {
  it("is true only for agent_settled of the given cluster", () => {
    const [settled] = stream("c1", [{ type: "agent_settled" }]);
    const [other] = stream("c2", [{ type: "agent_settled" }]);
    const [start] = stream("c1", [{ type: "agent_start" }]);

    expect(isRunEnd("c1", settled!)).toBe(true);
    expect(isRunEnd("c1", other!)).toBe(false);
    expect(isRunEnd("c1", start!)).toBe(false);
  });
});
