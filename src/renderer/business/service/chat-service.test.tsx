// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeRoute } from "../../../common/bridge/protocol";
import { encodeSseEvent } from "../../../common/bridge/sse";
import { ChatSessionStore, PreferencesStore } from "../../../common/store";
import { Message } from "../../components/message";
import { ApplicationContextProvider, useApplicationStatusStore } from "../../context/application-context";
import { IS_CONVERSATION_INTERRUPTED_KEY } from "../../context/chat-session-storage";
import { getTextMessage } from "../objects/message-object-provider";
import useChatService from "./chat-service";

import type { Renderer } from "@freelensapp/extensions";

import type { AgentRunEvent, AgentRunRequest, ApprovalRequest } from "../../../common/bridge/protocol";

const APPROVAL: ApprovalRequest = {
  question: "The agent has requested to use a tool",
  options: ["yes", "no"],
  actionToApprove: { action: ["kubectl_get"] },
  requestString: "The agent wants to use this tool: kubectl_get",
};

// The bridge in main, reduced to what the chat sends: every run request is
// recorded and answered with the next stream of `runs`.
let runs: AgentRunEvent[][];
let runRequests: AgentRunRequest[];
let clearRequests: number;

const answer = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const bridgeFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const { pathname } = new URL(String(input));
  if (pathname === BridgeRoute.run) {
    runRequests.push(JSON.parse(String(init?.body)));
    // Main ends a stream with `done`, or with the `error` that ends it early.
    const events: { type: string }[] = runs.shift() ?? [];
    if (events.at(-1)?.type !== "error") {
      events.push({ type: "done" });
    }
    return new Response(events.map(encodeSseEvent).join(""), { headers: { "content-type": "text/event-stream" } });
  }
  if (pathname === BridgeRoute.clear) {
    clearRequests += 1;
    return answer({});
  }
  return answer({});
};

const Chat = () => {
  const { sendMessageToAgent } = useChatService();
  const { clearChat, chatMessages } = useApplicationStatusStore();
  return (
    <>
      <button type="button" onClick={() => sendMessageToAgent(getTextMessage("list the pods", true))}>
        Ask for a tool
      </button>
      <button type="button" onClick={() => sendMessageToAgent(getTextMessage("hello", true))}>
        Say hello
      </button>
      <button type="button" onClick={() => clearChat()}>
        Clear chat
      </button>
      <div>
        {chatMessages?.map((message) => (
          <Message key={message.messageId} message={message} />
        ))}
      </div>
    </>
  );
};

const renderChat = () =>
  render(
    <ApplicationContextProvider extension={{} as Renderer.LensExtension}>
      <Chat />
    </ApplicationContextProvider>,
  );

const isInterrupted = () => window.sessionStorage.getItem(IS_CONVERSATION_INTERRUPTED_KEY) === "true";

beforeEach(() => {
  runs = [];
  runRequests = [];
  clearRequests = 0;
  vi.stubGlobal("fetch", vi.fn(bridgeFetch));
  const preferences = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  preferences.aiProxyPort = 4321;
  preferences.aiProxyToken = "token";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  PreferencesStore.resetInstance();
  ChatSessionStore.resetInstance();
});

describe("useChatService", () => {
  it("answers a pending approval with the next message", async () => {
    runs = [[{ type: "interrupt", value: APPROVAL }]];
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Ask for a tool" }));
    await waitFor(() => expect(isInterrupted()).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Say hello" }));

    await waitFor(() => expect(runRequests).toHaveLength(2));
    expect(runRequests[1]?.input).toEqual({ kind: "resume", answer: "hello" });
  });

  it("sends the next message as a new prompt once the chat with a pending approval is cleared", async () => {
    runs = [[{ type: "interrupt", value: APPROVAL }], [{ type: "text", text: "Hi there" }]];
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Ask for a tool" }));
    await waitFor(() => expect(isInterrupted()).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    await waitFor(() => expect(clearRequests).toBe(1));

    expect(isInterrupted()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Say hello" }));

    await screen.findByText(/Hi there/);
    expect(runRequests[1]?.input).toEqual({ kind: "message", text: "hello", summary: null });
  });

  it("sends the next message as a new prompt when main has no approval to answer", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    runs = [
      [{ type: "interrupt", value: APPROVAL }],
      [{ type: "error", error: { message: "There is no pending approval to answer.", code: "no-pending-approval" } }],
      [{ type: "text", text: "Hi there" }],
    ];
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Ask for a tool" }));
    await waitFor(() => expect(isInterrupted()).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Say hello" }));

    await screen.findByText(/There is no pending approval to answer/);
    expect(runRequests[1]?.input).toEqual({ kind: "resume", answer: "hello" });
    expect(isInterrupted()).toBe(false);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Say hello" }));

    await screen.findByText(/Hi there/);
    expect(runRequests[2]?.input).toEqual({ kind: "message", text: "hello", summary: null });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("offers a retry of a run that failed", async () => {
    runs = [[{ type: "error", error: { message: "The AI endpoint answered with a server error." } }]];
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Say hello" }));

    await screen.findByText(/answered with a server error/);
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
  });

  it("resets the approval state even when main cannot clear the conversation", async () => {
    runs = [[{ type: "interrupt", value: APPROVAL }]];
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Ask for a tool" }));
    await waitFor(() => expect(isInterrupted()).toBe(true));
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().aiProxyPort = null;
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));

    await waitFor(() => expect(screen.queryByText(/kubectl_get/)).toBeNull());
    expect(isInterrupted()).toBe(false);
    expect(clearRequests).toBe(0);
  });
});
