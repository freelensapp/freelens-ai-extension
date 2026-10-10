import { Renderer } from "@freelensapp/extensions";
import {
  AGENT_COMMAND_CHANNEL,
  AGENT_ENVELOPE_CHANNEL,
  type AgentCommand,
  type AgentEnvelope,
  type AgentResponse,
  type AgentSnapshot,
  type ToolRequest,
} from "../../../common/agent-protocol";
import { ChatSessionStore } from "../../../common/store";
import { IS_LOADING_KEY } from "../../context/chat-session-storage";
import { getClusterVersion } from "../agent/tools/kubernetes-resource";
import { getFrameClusterId } from "../cluster/active-cluster";
import { type ChatViewState, chatFromSnapshot, reduceEnvelope } from "./chat-reducer";
import { runToolRequest, type ToolImplementation } from "./tool-runner";

// The cluster frame's side of the agent protocol: it sends commands to the pi
// agent host in main, answers the tool calls main sends for this cluster, and
// keeps this cluster's chat in step with main's snapshot and envelopes.

class AgentRendererIpc extends Renderer.Ipc {}

/** Called with the chat after every change. */
type ChatListener = (chat: ChatViewState) => void;

const CLUSTER_TOOLS: Readonly<Record<string, ToolImplementation>> = {
  getClusterVersion: () => getClusterVersion(),
};

const listeners = new Set<ChatListener>();
let ipc: AgentRendererIpc | undefined;
let chat: ChatViewState | undefined;
// Envelopes that arrive while a snapshot is on its way; undefined when none is.
let buffered: AgentEnvelope[] | undefined;
// Tool calls this frame has run or is running, so a snapshot taken before main
// got the result does not run them twice.
const MAX_HANDLED_TOOLS = 200;
const handledTools = new Set<string>();

const failure = (command: AgentCommand, error: string): AgentResponse => ({
  type: "response",
  command: command.type,
  success: false,
  error,
});

/**
 * Starts listening for main's envelopes and loads the chat from main's
 * snapshot. Only cluster frames take part: the root window receives the same
 * broadcasts but must not answer tool calls.
 */
export function startAgentClient(extension: Renderer.LensExtension): void {
  const clusterId = getFrameClusterId();
  if (!clusterId || ipc) {
    return;
  }
  ipc = AgentRendererIpc.createInstance(extension) as AgentRendererIpc;
  // `messages` is read back from the saved transcript; see getAgentChat.
  chat = { clusterId, seq: 0, messages: [], isRunning: false };
  ipc.listen(AGENT_ENVELOPE_CHANNEL, (_event, envelope: AgentEnvelope) => {
    if (envelope?.clusterId !== clusterId) {
      return;
    }
    if (envelope.kind === "tool_request") {
      answerToolRequest(clusterId, envelope.payload);
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

/**
 * The chat as it stands now, or undefined outside a cluster frame. The saved
 * transcript is the source of the messages, because the chat page also adds
 * to it (the user's own message, refused prompts, AI Explain).
 */
export function getAgentChat(): ChatViewState | undefined {
  if (!chat) return undefined;
  const messages = ChatSessionStore.getInstanceOrCreate<ChatSessionStore>().getMessages(chat.clusterId) ?? [];
  return { ...chat, messages };
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
  const base =
    snapshot.messages.length > 0 || snapshot.streamingMessage
      ? chatFromSnapshot(clusterId, snapshot)
      : { ...getAgentChat()!, seq: snapshot.seq, isRunning: snapshot.isStreaming, stale: undefined };
  // Envelopes that came in meanwhile and are newer than the snapshot apply on
  // top of it; older ones are already in it.
  const newer = pending.filter((envelope) => envelope.seq > snapshot.seq);
  update(newer.reduce(reduceEnvelope, base));
  // A frame that opened mid-run never saw these requests go out.
  for (const request of snapshot.pendingToolRequests) {
    answerToolRequest(clusterId, request);
  }
}

function update(next: ChatViewState): void {
  const previous = getAgentChat()!;
  chat = next;
  // Mirror the transcript and run state into the frame's stores here rather
  // than in the chat page, so a run keeps being recorded while the page is
  // closed and a page opened later shows the right spinner.
  if (next.messages !== previous.messages) {
    ChatSessionStore.getInstanceOrCreate<ChatSessionStore>().setMessages(next.clusterId, next.messages);
  }
  if (next.isRunning !== previous.isRunning) {
    window.sessionStorage.setItem(IS_LOADING_KEY, String(next.isRunning));
  }
  for (const listener of listeners) {
    listener(next);
  }
}

function isClusterConnected(clusterId: string): boolean {
  try {
    const status = Renderer.Catalog.getClusterById?.(clusterId)?.status;
    // Unknown on hosts without the cluster API: let the call try.
    return status === undefined || status === "connected";
  } catch {
    return true;
  }
}

function answerToolRequest(clusterId: string, request: ToolRequest): void {
  if (handledTools.has(request.requestId)) return;
  handledTools.add(request.requestId);
  // Sets iterate in insertion order: forget the oldest ids first.
  for (const requestId of handledTools) {
    if (handledTools.size <= MAX_HANDLED_TOOLS) break;
    handledTools.delete(requestId);
  }
  void (async () => {
    const reply = await runToolRequest(request, CLUSTER_TOOLS, {
      isClusterConnected: () => isClusterConnected(clusterId),
    });
    const response = await sendAgentCommand(clusterId, {
      type: "tool_result",
      requestId: request.requestId,
      text: reply.text,
      isError: reply.isError,
    });
    if (!response.success) {
      console.warn("[freelens-ai] Tool result was not accepted:", response.error);
    }
  })();
}
