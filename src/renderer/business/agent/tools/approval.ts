// Human-in-the-loop approval gate shared by every write tool (and the optional
// pod-logs gate). Kept free of host dependencies so the payload and the resume
// protocol can be unit-tested directly (see approval.test.ts).
//
// Strands' `ToolContext.interrupt()` mirrors LangGraph's `interrupt()`: on the
// first run it halts the agent with `stopReason: "interrupt"` and surfaces the
// `reason` to the caller; when the agent is resumed with an interrupt response,
// the tool runs again from the start and `interrupt()` returns that response.

import { stringify as stringifyYaml } from "yaml";

import type { JSONValue, ToolContext } from "@strands-agents/sdk";

// The part of a tool context (or hook event) able to raise an interrupt.
type Interruptible = Pick<ToolContext, "interrupt">;

// Name of the interrupt raised by the Kubernetes write tools. Must be stable
// across the first run and the resumed run of the same tool call.
export const APPROVAL_INTERRUPT_NAME = "freelens-approval";

// The only answer that approves an action; anything else denies it.
export const APPROVE_OPTION = "yes";
export const DENY_OPTION = "no";

export const DENIED_ACTION_MESSAGE = "The user denied the action";

// The payload surfaced to the chat UI as the interrupt reason. The field names
// are the ones the approval prompt (see `getInterruptMessage`) reads.
export interface ApprovalRequest {
  question: string;
  options: string[];
  actionToApprove: { action: string | string[] } & Record<string, unknown>;
  // Structured fields consumed by the Interrupt component to render foldable
  // "Action details" and "Resources that will be changed" sections.
  actionString?: string;
  resourcesString?: string;
  // Markdown fallback for renderers that do not understand the structured
  // fields (for example the MCP tool approval prompt).
  requestString: string;
}

/**
 * Build the approval payload for a Kubernetes write action. When
 * `resourcesYaml` is provided it carries the current full YAML of the resources
 * the action will change, presented as a folded backup so the change can be
 * reverted.
 */
export function buildApprovalRequest(
  action: string,
  payload: Record<string, unknown>,
  resourcesYaml?: string,
): ApprovalRequest {
  const actionToApprove = { action, ...payload };
  // Render the payload as YAML, the native format of the Kubernetes world, so
  // the approval prompt is highlighted as YAML rather than JSON.
  const actionString = stringifyYaml(actionToApprove);
  return {
    question: "Do you want to approve this action?",
    options: [APPROVE_OPTION, DENY_OPTION],
    actionToApprove,
    actionString,
    resourcesString: resourcesYaml,
    requestString: "```yaml\n" + actionString + "```",
  };
}

/**
 * Build the approval payload for a tool served by an MCP server. MCP tools are
 * opaque to the extension, so the prompt only names the tool.
 */
export function buildMcpApprovalRequest(toolName: string): ApprovalRequest {
  return {
    question: "The agent has requested to use a tool",
    options: [APPROVE_OPTION, DENY_OPTION],
    actionToApprove: { action: [toolName] },
    requestString: "The agent wants to use this tool: " + toolName,
  };
}

// Interrupt reasons must be JSON values: drop `undefined` fields (for example an
// omitted namespace) and any non-serializable content from the manifest.
export const toInterruptReason = (request: ApprovalRequest): JSONValue => JSON.parse(JSON.stringify(request));

export const isApprovalRequest = (value: unknown): value is ApprovalRequest =>
  typeof value === "object" &&
  value !== null &&
  "question" in value &&
  "options" in value &&
  "actionToApprove" in value &&
  "requestString" in value;

/**
 * Run the approval gate for a write operation. Returns true only when the user
 * answered "yes". Without an interruptible context (a direct tool call outside
 * the agent loop) the action is denied, never silently approved.
 */
export function requestApproval(
  context: Interruptible | undefined,
  action: string,
  payload: Record<string, unknown>,
  resourcesYaml?: string,
): boolean {
  if (!context) {
    return false;
  }
  const review = context.interrupt<JSONValue>({
    name: APPROVAL_INTERRUPT_NAME,
    reason: toInterruptReason(buildApprovalRequest(action, payload, resourcesYaml)),
  });
  console.log("Tool call review: ", review);
  return review === APPROVE_OPTION;
}
