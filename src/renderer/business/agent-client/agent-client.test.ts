// @vitest-environment jsdom

import { Renderer } from "@freelensapp/extensions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ipcMainHandlers } from "../../../../test/freelens-extensions";
import { AGENT_COMMAND_CHANNEL } from "../../../common/agent-protocol";
import { getAgentChat, sendAgentCommand, startAgentClient, stopAgentClient } from "./agent-client";

afterEach(() => {
  stopAgentClient();
  ipcMainHandlers.clear();
});

// jsdom serves the page from `localhost`, the host of the root window, which
// has no cluster id.
describe("the agent client in the root window", () => {
  it("has no chat and sends nothing to main", async () => {
    const handler = vi.fn();
    ipcMainHandlers.set(AGENT_COMMAND_CHANNEL, handler);
    // The stubbed base class reads nothing of the installed extension.
    const installed = {} as ConstructorParameters<typeof Renderer.LensExtension>[0];
    startAgentClient(new Renderer.LensExtension(installed));

    const response = await sendAgentCommand(undefined, { type: "prompt", message: "hi" });

    expect(getAgentChat()).toBeUndefined();
    expect(response).toMatchObject({ success: false });
    expect(handler).not.toHaveBeenCalled();
  });
});
