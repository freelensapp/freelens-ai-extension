// The single Freelens agent: one Strands agent loop with every tool attached
// (the built-in Kubernetes tools plus, when enabled, the MCP server tools).
//
// Free of host dependencies (model, tools and storage are injected) so the
// agent loop, the approval interrupts and the session persistence can be
// exercised in unit tests with a scripted model (see freelens-agent.test.ts).

import { Agent, BeforeToolCallEvent, InterruptResponseContent, SessionManager } from "@strands-agents/sdk";
import { APPROVE_OPTION, buildMcpApprovalRequest, DENIED_ACTION_MESSAGE, toInterruptReason } from "./tools/approval";

import type { InvokeArgs, Model, Storage, Tool } from "@strands-agents/sdk";

// Name of the interrupt raised before every MCP tool call.
export const MCP_APPROVAL_INTERRUPT_NAME = "freelens-mcp-approval";

export interface FreelensAgentConfig {
  model: Model;
  systemPrompt: string;
  // Built-in tools. They run their own approval gate for write operations.
  tools: Tool[];
  // Tools served by MCP servers. Opaque to the extension, so every call is
  // approved by the user first.
  mcpTools?: Tool[];
  // Durable storage for the session snapshot (conversation + pending
  // approvals), restored when the agent initializes.
  storage: Storage;
  sessionId: string;
}

export const createFreelensAgent = ({
  model,
  systemPrompt,
  tools,
  mcpTools = [],
  storage,
  sessionId,
}: FreelensAgentConfig): Agent => {
  const agent = new Agent({
    name: "Freelens Agent",
    model,
    systemPrompt,
    tools: [...tools, ...mcpTools],
    printer: false,
    // One tool at a time, so a turn that requests several write actions shows
    // one approval prompt at a time, in order.
    toolExecutor: "sequential",
    sessionManager: new SessionManager({ sessionId, storage }),
  });

  const mcpToolNames = new Set(mcpTools.map((mcpTool) => mcpTool.name));
  agent.addHook(BeforeToolCallEvent, (event) => {
    if (!mcpToolNames.has(event.toolUse.name)) {
      return;
    }
    const review = event.interrupt({
      name: MCP_APPROVAL_INTERRUPT_NAME,
      reason: toInterruptReason(buildMcpApprovalRequest(event.toolUse.name)),
    });
    if (review !== APPROVE_OPTION) {
      event.cancel = DENIED_ACTION_MESSAGE;
    }
  });

  return agent;
};

/**
 * Build the arguments that resume a paused run by answering every pending
 * approval with `answer` ("yes"/"no"). Returns null when nothing is pending
 * (for example a stale approval prompt clicked after the chat moved on).
 *
 * The pending interrupts are read from the agent rather than from the UI so
 * the answer still applies after an application restart: the session manager
 * restores them together with the conversation.
 */
export const buildResumeArgs = (agent: Agent, answer: string): InvokeArgs | null => {
  const pending = agent._interruptState.getUnansweredInterrupts();
  if (pending.length === 0) {
    return null;
  }
  return pending.map((interrupt) => new InterruptResponseContent({ interruptId: interrupt.id, response: answer }));
};

/**
 * Drop a pending approval the user moved past by sending a new message instead
 * of answering it. The paused tool call never ran and its assistant turn was
 * never committed to the history, so the conversation stays consistent.
 */
export const abandonPendingApprovals = (agent: Agent): void => {
  if (agent._interruptState.activated) {
    agent._interruptState.deactivate();
  }
};

/**
 * Forget the conversation: clear the history and any pending approval, and
 * persist the empty session so a restart does not restore it.
 */
export const resetConversation = async (agent: Agent): Promise<void> => {
  abandonPendingApprovals(agent);
  agent.messages.splice(0, agent.messages.length);
  await agent.sessionManager?.saveSnapshot({ target: agent, isLatest: true });
};
