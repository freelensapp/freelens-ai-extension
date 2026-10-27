import { Renderer } from "@freelensapp/extensions";
import {
  AGENT_COMMAND_CHANNEL,
  AGENT_ENVELOPE_CHANNEL,
  type AgentCommand,
  type AgentEnvelope,
  type AgentResponse,
  type AgentSnapshot,
} from "../../../common/agent-protocol";
import { IS_LOADING_KEY } from "../../context/chat-session-storage";
import { getFrameClusterId } from "../cluster/active-cluster";
import { type ChatViewState, chatFromSnapshot, reconcileApprovals, reduceEnvelope } from "./chat-reducer";

import type { MessageObject } from "../../../common/objects/message-object";

// The cluster frame's side of the agent protocol: it sends commands to the pi
// agent host in main and keeps this cluster's chat in step with main's
// snapshot and envelopes. The cluster tools run in main; the frame only shows
// their calls and the approval cards.

class AgentRendererIpc extends Renderer.Ipc {}

/** Called with the chat after every change. */
type ChatListener = (chat: ChatViewState) => void;

const listeners = new Set<ChatListener>();
let ipc: AgentRendererIpc | undefined;
let chat: ChatViewState | undefined;
// Envelopes that arrive while a snapshot is on its way; undefined when none is.
let buffered: AgentEnvelope[] | undefined;

const failure = (command: AgentCommand, error: string): AgentResponse => ({
  type: "response",
  command: command.type,
  success: false,
  error,
});

/**
 * Starts listening for main's envelopes and loads the chat from main's
 * snapshot. Only cluster frames take part: the root window receives the same
 * broadcasts and ignores them.
 */
export function startAgentClient(extension: Renderer.LensExtension): void {
  const clusterId = getFrameClusterId();
  if (!clusterId || ipc) {
    return;
  }
  ipc = AgentRendererIpc.createInstance(extension) as AgentRendererIpc;
  chat = { clusterId, seq: 0, messages: [], isRunning: false, autoApprove: false };
  ipc.listen(AGENT_ENVELOPE_CHANNEL, (_event, envelope: AgentEnvelope) => {
    if (envelope?.clusterId !== clusterId) {
      return;
    }
    if (buffered) {
      buffered.push(envelope);
      return;
    }
    update(reduceEnvelope(getAgentChat()!, envelope));
    if (chat!.stale) {
      void loadSnapshot(clusterId);
    }
  });
  void loadSnapshot(clusterId);
}

/** The chat as it stands now, or undefined outside a cluster frame. */
export function getAgentChat(): ChatViewState | undefined {
  return chat;
}

/**
 * Changes the transcript from the chat page: the user's own message, a prompt
 * main refused, an error that was retried. It lives in this frame only; main's
 * snapshot rebuilds it from the pi session.
 */
export function editAgentTranscript(edit: (messages: MessageObject[]) => MessageObject[]): void {
  if (!chat) return;
  const messages = edit(chat.messages);
  if (messages !== chat.messages) {
    update({ ...chat, messages });
  }
}

export function onAgentChat(listener: ChatListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function sendAgentCommand(clusterId: string, command: AgentCommand): Promise<AgentResponse> {
  if (!ipc) {
    return failure(command, "The Freelens AI agent is only available in a cluster window.");
  }
  try {
    return await ipc.invoke(AGENT_COMMAND_CHANNEL, clusterId, command);
  } catch (error) {
    return failure(command, `Could not reach the Freelens AI agent: ${error instanceof Error ? error.message : error}`);
  }
}

// Rebuilds the chat from main: on frame start (also after a Freelens restart,
// from the session file) and when envelopes were missed.
async function loadSnapshot(clusterId: string): Promise<void> {
  if (buffered) return;
  buffered = [];
  const response = await sendAgentCommand(clusterId, { type: "get_snapshot" });
  const pending = buffered;
  buffered = undefined;
  if (!response.success) {
    console.warn("[freelens-ai] Loading the chat from the agent failed:", response.error);
    update(pending.reduce(reduceEnvelope, { ...getAgentChat()!, stale: undefined }));
    return;
  }
  const snapshot = response.data as AgentSnapshot;
  // A cluster with no saved session keeps the transcript it has, such as a
  // prompt that was refused before any run.
  const current = getAgentChat()!;
  const base = reconcileApprovals(
    snapshot.messages.length > 0 || snapshot.streamingMessage
      ? chatFromSnapshot(clusterId, snapshot)
      : {
          ...current,
          seq: snapshot.seq,
          isRunning: snapshot.isStreaming,
          autoApprove: snapshot.autoApprove,
          stats: snapshot.stats,
          stale: undefined,
        },
    snapshot.pendingUiRequest?.id,
  );
  // Envelopes that came in meanwhile and are newer than the snapshot apply on
  // top of it; older ones are already in it.
  const newer = pending.filter((envelope) => envelope.seq > snapshot.seq);
  update(newer.reduce(reduceEnvelope, base));
}

function update(next: ChatViewState): void {
  const previous = getAgentChat()!;
  chat = next;
  // Mirror the run state here rather than in the chat page, so a page opened
  // later shows the right spinner.
  if (next.isRunning !== previous.isRunning) {
    window.sessionStorage.setItem(IS_LOADING_KEY, String(next.isRunning));
  }
  for (const listener of listeners) {
    listener(next);
  }
}

/**
 * New chat, or Delete all chats of this cluster. Main stops a run first and
 * answers with the empty chat's snapshot, which replaces the transcript; its
 * `seq` makes the frame ignore late envelopes of the old chat.
 */
export async function resetAgentChat(
  clusterId: string,
  type: "new_session" | "delete_sessions",
): Promise<AgentResponse> {
  const response = await sendAgentCommand(clusterId, { type });
  if (response.success && chat?.clusterId === clusterId) {
    const snapshot = response.data as AgentSnapshot;
    update(chatFromSnapshot(clusterId, snapshot));
  }
  return response;
}

/**
 * Answers a pending approval card. The card turns approved or denied when main
 * broadcasts the result, so a card answered elsewhere (Stop) stays in step.
 * `approveAll` also turns on "Approve all in this chat".
 */
export async function answerApproval(
  clusterId: string,
  id: string,
  confirmed: boolean,
  approveAll = false,
): Promise<AgentResponse> {
  return sendAgentCommand(clusterId, { type: "ui_response", id, confirmed, ...(approveAll ? { approveAll } : {}) });
}

/** Turns "Approve all in this chat" off; the notice goes when main broadcasts the change. */
export async function turnOffAutoApprove(clusterId: string): Promise<AgentResponse> {
  return sendAgentCommand(clusterId, { type: "set_auto_approve", enabled: false });
}
