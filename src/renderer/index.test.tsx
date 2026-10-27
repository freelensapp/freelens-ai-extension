// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://c1.localhost/"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipcMainHandlers, ipcRendererListeners } from "../../test/freelens-extensions";
import {
  AGENT_COMMAND_CHANNEL,
  AGENT_ENVELOPE_CHANNEL,
  type AgentCommand,
  type AgentEnvelope,
  type AgentResponse,
  type AgentSnapshot,
} from "../common/agent-protocol";
import { PROVIDER_ENVELOPE_CHANNEL, type ProviderEnvelope } from "../common/provider-protocol";
import { PreferencesStore } from "../common/store";
import { getAgentChat } from "./business/agent-client/agent-client";
import { onProviderEnvelope } from "./business/provider-client/provider-client";
import FreeLensAIRenderer from "./index";

let loaded: FreeLensAIRenderer[];

// The host's order: a new instance is activated, then enabled; `disable()`
// awaits `onDeactivate` and then removes what the extension registered, its
// IPC listeners included.
const load = async () => {
  // The stubbed base class reads nothing of the installed extension.
  const installed = {} as ConstructorParameters<typeof FreeLensAIRenderer>[0];
  const extension = new FreeLensAIRenderer(installed);
  loaded.push(extension);
  await extension.activate();
  await extension.enable();
  return extension;
};

const emptySnapshot: AgentSnapshot = { messages: [], isStreaming: false, autoApprove: false, seq: 0 };

// Main's side of the agent channel: every snapshot is the empty chat.
const answerAgentCommand = (_event: unknown, ...args: unknown[]): AgentResponse => {
  const command = args[1] as AgentCommand;
  return { type: "response", command: command.type, success: true, data: emptySnapshot };
};

// Broadcasts to the listeners of a channel as main would.
const broadcast = (channel: string, payload: unknown) => {
  for (const listener of ipcRendererListeners.get(channel) ?? []) listener({}, payload);
};

const listenerCount = (channel: string) => ipcRendererListeners.get(channel)?.size ?? 0;

beforeEach(() => {
  loaded = [];
  ipcMainHandlers.set(AGENT_COMMAND_CHANNEL, answerAgentCommand);
});

afterEach(async () => {
  for (const extension of loaded) await extension.disable();
  ipcMainHandlers.clear();
  ipcRendererListeners.clear();
  PreferencesStore.resetInstance();
});

describe("FreeLensAIRenderer", () => {
  it("connects the agent and provider clients again after Disable and Enable", async () => {
    const first = await load();
    await first.disable();
    expect(listenerCount(AGENT_ENVELOPE_CHANNEL)).toBe(0);
    expect(listenerCount(PROVIDER_ENVELOPE_CHANNEL)).toBe(0);

    await load();
    expect(listenerCount(AGENT_ENVELOPE_CHANNEL)).toBe(1);
    expect(listenerCount(PROVIDER_ENVELOPE_CHANNEL)).toBe(1);
    await vi.waitFor(() => expect(getAgentChat()).toMatchObject({ clusterId: "c1", seq: 0 }));

    const start: AgentEnvelope = {
      clusterId: "c1",
      sessionId: "s1",
      seq: 1,
      kind: "event",
      payload: { type: "agent_start" },
    };
    broadcast(AGENT_ENVELOPE_CHANNEL, start);
    expect(getAgentChat()).toMatchObject({ seq: 1, isRunning: true });

    const received: ProviderEnvelope[] = [];
    onProviderEnvelope((envelope) => received.push(envelope));
    broadcast(PROVIDER_ENVELOPE_CHANNEL, { kind: "credentials_changed" });
    expect(received).toEqual([{ kind: "credentials_changed" }]);
  });

  it("ignores a snapshot that answers after Disable", async () => {
    let answerSnapshot: (response: AgentResponse) => void = () => {};
    ipcMainHandlers.set(
      AGENT_COMMAND_CHANNEL,
      () => new Promise<AgentResponse>((resolve) => (answerSnapshot = resolve)),
    );
    const extension = await load();
    await vi.waitFor(() => expect(getAgentChat()).toBeDefined());

    await extension.disable();
    answerSnapshot({ type: "response", command: "get_snapshot", success: true, data: emptySnapshot });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAgentChat()).toBeUndefined();
  });

  it("drops the chat of the agent client on Disable", async () => {
    const extension = await load();
    await vi.waitFor(() => expect(getAgentChat()).toMatchObject({ clusterId: "c1" }));

    await extension.disable();

    expect(getAgentChat()).toBeUndefined();
  });
});
