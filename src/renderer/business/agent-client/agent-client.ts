import { Renderer } from "@freelensapp/extensions";
import {
  AGENT_COMMAND_CHANNEL,
  AGENT_ENVELOPE_CHANNEL,
  type AgentCommand,
  type AgentEnvelope,
  type AgentResponse,
  type ToolRequest,
} from "../../../common/agent-protocol";
import { ChatSessionStore } from "../../../common/store";
import { IS_LOADING_KEY } from "../../context/chat-session-storage";
import { getClusterVersion } from "../agent/tools/kubernetes-resource";
import { getFrameClusterId } from "../cluster/active-cluster";
import { isRunEnd, reduceEnvelope } from "./chat-reducer";
import { runToolRequest, type ToolImplementation } from "./tool-runner";

import type { MessageObject } from "../objects/message-object";

// The cluster frame's side of the agent protocol: it sends commands to the pi
// agent host in main, answers the tool calls main sends for this cluster, and
// hands this cluster's envelopes to the chat.

class AgentRendererIpc extends Renderer.Ipc {}

/** Called with each envelope of this frame's cluster and the transcript after it. */
type EnvelopeListener = (envelope: AgentEnvelope, messages: MessageObject[]) => void;

const CLUSTER_TOOLS: Readonly<Record<string, ToolImplementation>> = {
  getClusterVersion: () => getClusterVersion(),
};

const listeners = new Set<EnvelopeListener>();
let ipc: AgentRendererIpc | undefined;

const failure = (command: AgentCommand, error: string): AgentResponse => ({
  type: "response",
  command: command.type,
  success: false,
  error,
});

/**
 * Starts listening for main's envelopes. Only cluster frames take part: the
 * root window receives the same broadcasts but must not answer tool calls.
 */
export function startAgentClient(extension: Renderer.LensExtension): void {
  const clusterId = getFrameClusterId();
  if (!clusterId || ipc) {
    return;
  }
  ipc = AgentRendererIpc.createInstance(extension) as AgentRendererIpc;
  const chatSessionStore = ChatSessionStore.getInstanceOrCreate<ChatSessionStore>();
  let seq = 0;
  ipc.listen(AGENT_ENVELOPE_CHANNEL, (_event, envelope: AgentEnvelope) => {
    if (envelope?.clusterId !== clusterId) {
      return;
    }
    if (envelope.kind === "tool_request") {
      void answerToolRequest(clusterId, envelope.payload);
    }
    // Fold the envelope into the saved transcript here rather than in the chat
    // page, so a run keeps being recorded while the page is closed.
    const previous = chatSessionStore.getMessages(clusterId) ?? [];
    const next = reduceEnvelope({ clusterId, seq, messages: previous }, envelope);
    seq = next.seq;
    if (next.messages !== previous) {
      chatSessionStore.setMessages(clusterId, next.messages);
    }
    // Likewise clear the saved spinner state, so a chat page opened after the
    // run ended does not come back spinning.
    if (isRunEnd(clusterId, envelope)) {
      window.sessionStorage.setItem(IS_LOADING_KEY, "false");
    }
    for (const listener of listeners) {
      listener(envelope, next.messages);
    }
  });
}

export function onAgentEnvelope(listener: EnvelopeListener): () => void {
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

async function answerToolRequest(clusterId: string, request: ToolRequest): Promise<void> {
  const reply = await runToolRequest(request, CLUSTER_TOOLS);
  const response = await sendAgentCommand(clusterId, {
    type: "tool_result",
    requestId: request.requestId,
    text: reply.text,
    isError: reply.isError,
  });
  if (!response.success) {
    console.warn("[freelens-ai] Tool result was not accepted:", response.error);
  }
}
