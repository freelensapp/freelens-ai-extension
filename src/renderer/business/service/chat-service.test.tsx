// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { ChatSessionStore, PreferencesStore } from "../../../common/store";
import { ApplicationContextProvider, useApplicationStatusStore } from "../../context/application-context";
import { streamFromBridge } from "../bridge/bridge-client";
import { getExplainMessage, getTextMessage } from "../objects/message-object-provider";
import useChatService, { CANCELLED_NOTICE } from "./chat-service";

import type { Renderer } from "@freelensapp/extensions";

import type { AgentRunEvent } from "../../../common/bridge/protocol";

vi.mock("../bridge/bridge-client", () => ({
  streamFromBridge: vi.fn(),
  getFromBridge: vi.fn(),
  postToBridge: vi.fn(),
}));

const streamMock = vi.mocked(streamFromBridge);

// Answers the next stream request with `events`, then fails with `error` if
// one is given, as a body cut by the network does.
const answerWith = (events: AgentRunEvent[], error?: Error) => {
  streamMock.mockImplementationOnce(async function* () {
    for (const event of events) {
      yield event as never;
    }
    if (error) {
      throw error;
    }
  });
};

// Shows the transcript, one element per message, and starts the requests.
const Chat = () => {
  const { chatMessages, isLoading } = useApplicationStatusStore();
  const chatService = useChatService();
  return (
    <>
      {chatMessages?.map((message) => (
        <p key={message.messageId} data-testid={message.notice ? "notice" : message.error ? "error" : "message"}>
          {message.text}
        </p>
      ))}
      <span>{isLoading ? "loading" : "idle"}</span>
      <button type="button" onClick={() => chatService.sendMessageToAgent(getTextMessage("Hello", true))}>
        Send
      </button>
      <button type="button" onClick={() => chatService.sendMessageToAgent(getExplainMessage("BackOff"))}>
        Explain
      </button>
      <button type="button" onClick={() => chatService.resumeInterrupt("yes")}>
        Approve
      </button>
    </>
  );
};

const extension = { navigateToPreferences: vi.fn() } as unknown as Renderer.LensExtension;

const renderChat = () =>
  render(
    <ApplicationContextProvider extension={extension}>
      <Chat />
    </ApplicationContextProvider>,
  );

const texts = (testId: string) => screen.queryAllByTestId(testId).map((element) => element.textContent);

describe("useChatService", () => {
  let consoleError: MockInstance<typeof console.error>;

  // The lines the chat logs at error level, which DevTools shows as errors.
  // React's own development warnings are left out: the transcript's state
  // updaters write ChatSessionStore, which React's development build reports
  // when two updates of one tick are applied in a render.
  const loggedErrors = () =>
    consoleError.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("[useChatService]"));

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
    streamMock.mockReset();
    window.sessionStorage.clear();
    PreferencesStore.resetInstance();
    ChatSessionStore.resetInstance();
  });

  it("ends a run cancelled by the bridge with a note, and logs no error", async () => {
    answerWith([{ type: "text", text: "Half an" }, { type: "cancelled" }]);
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByTestId("notice")).toHaveProperty("textContent", CANCELLED_NOTICE);
    await screen.findByText("idle");
    expect(texts("message")).toEqual(["Hello", "Half an"]);
    expect(texts("error")).toEqual([]);
    expect(loggedErrors()).toEqual([]);
  });

  it("ends an Explain cancelled by the bridge with a note, and logs no error", async () => {
    answerWith([{ type: "cancelled" }]);
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Explain" }));

    expect(await screen.findByTestId("notice")).toHaveProperty("textContent", CANCELLED_NOTICE);
    expect(texts("error")).toEqual([]);
    expect(loggedErrors()).toEqual([]);
  });

  it("starts the next answer after the note rather than in it", async () => {
    answerWith([{ type: "text", text: "Half an" }, { type: "cancelled" }]);
    answerWith([{ type: "text", text: "Applied." }, { type: "done" }]);
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByTestId("notice");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await screen.findByText("Applied.");
    expect(texts("notice")).toEqual([CANCELLED_NOTICE]);
    expect(texts("message")).toEqual(["Hello", "Half an", "Applied."]);
  });

  it("keeps a stream cut by the network an error", async () => {
    answerWith([{ type: "text", text: "Half an" }], new TypeError("network error"));
    renderChat();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByTestId("error")).toHaveProperty(
      "textContent",
      "Error while running Freelens Agent: network error",
    );
    expect(texts("notice")).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      "[useChatService] Error while running Freelens Agent: ",
      expect.any(TypeError),
    );
  });
});
