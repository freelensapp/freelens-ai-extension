// The approval gate of the kubectl and helm tools. pi's `tool_call` hook runs
// every call through the invocation policy with the cluster's profile: the
// floor and Deny block it with the reason, Allow runs it, Ask asks unless
// "Approve all in this chat" is on, and Always ask always asks. The tool runs
// only a call the gate let through, with what the policy decided about it.

import { randomUUID } from "node:crypto";
import { defineTool, type ToolCallEvent, type ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { errorText } from "../../common/agent-protocol";
import { helmTool, kubectlTool } from "../../common/agent-tools";
import { DRY_RUN_VERBS } from "../../common/invocation-policy/dry-run-verbs";
import {
  evaluateInvocationPolicy,
  type InvocationPolicyResult,
} from "../../common/invocation-policy/invocation-policy";
import {
  CLUSTER_NOT_CONNECTED,
  DENIED_REASON,
  dryRunRejectionReason,
  floorBlockReason,
  profileDenyReason,
} from "./tools/block-reasons";
import { type CliToolInput, prepareCliInvocation, runCliTool } from "./tools/cli-tool";
import { type ClusterReadContext, ClusterResourceCache, type ClusterResources } from "./tools/cluster-resources";
import { previewHelmInvocation } from "./tools/helm-preview";
import { previewKubectlInvocation } from "./tools/kubectl-preview";
import { planSecretRedaction, type SecretRedaction } from "./tools/secret-redaction";

import type { AgentEnvelope, CliApprovalPreview, CliApprovalRequest } from "../../common/agent-protocol";
import type { AgentToolDefinition } from "../../common/agent-tools";
import type { CliProgram } from "../../common/invocation-policy/canonical-form";
import type { PolicyProfile } from "../../common/invocation-policy/policy-profile";
import type { CliRunner } from "./cli-runner";

// `ClusterConnectionStatus.CONNECTED` of the host's catalog.
const CONNECTED = "connected";

/** The program each CLI tool runs, by the tool's name. */
const CLI_TOOL_PROGRAMS: ReadonlyMap<string, CliProgram> = new Map([
  [kubectlTool.name, "kubectl"],
  [helmTool.name, "helm"],
]);

/** Whether a tool runs CLI invocations, so its calls go through the gate. */
export const isCliTool = (tool: AgentToolDefinition): boolean => CLI_TOOL_PROGRAMS.has(tool.name);

/**
 * A call that waits for approval, checked under the cluster's profile as it is
 * now: the reason to block it, or the level and the profile's name its card
 * shows. A level of Allow shows as Ask: the user still answers it.
 */
export type ApprovalCheck = { block: string } | Pick<CliApprovalRequest, "level" | "profileName">;

// A call that waits for approval, checked under `profile`: the floor entry or the profile's Deny blocks it.
const approvalCheck = (profile: PolicyProfile, decision: InvocationPolicyResult): ApprovalCheck => {
  if (decision.kind === "floor") return { block: floorBlockReason(decision) };
  if (decision.level === "deny") return { block: profileDenyReason(profile, decision) };
  return { level: decision.level === "alwaysAsk" ? "alwaysAsk" : "ask", profileName: profile.name };
};

// The policy's result for a kubectl or helm call with the agent's own
// arguments, before the tool adds `-f -` or a logs tail. helm needs the
// namespace only.
const evaluateCliCall = (
  program: CliProgram,
  input: CliToolInput,
  profile: PolicyProfile,
  { catalog, defaultNamespace }: ClusterResources,
): InvocationPolicyResult =>
  evaluateInvocationPolicy({
    program,
    args: input.args,
    ...(input.manifest === undefined ? {} : { manifest: input.manifest }),
    revealSecrets: input.revealSecrets === true,
    profile,
    catalog,
    defaultNamespace,
  });

interface PendingApproval {
  clusterId: string;
  sessionId: string;
  /** Replaced when a check gives it another level or profile, so the answer is gated on the current level. */
  request: CliApprovalRequest;
  /** Settles the approval; a denial blocks the call with `reason`, the user's denial by default. */
  settle: (confirmed: boolean, reason?: string) => void;
  checkNow: () => ApprovalCheck;
}

type SendEnvelope = (clusterId: string, sessionId: string, body: Pick<AgentEnvelope, "kind" | "payload">) => void;

/**
 * The approvals of every cluster's chat that wait for the user's answer. No
 * timeout: an approval waits until the user answers or something denies it.
 */
export class PendingApprovals {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(private readonly send: SendEnvelope) {}

  /** The approval of a request id, with its cluster and its current request. */
  get(id: string): Pick<PendingApproval, "clusterId" | "request"> | undefined {
    return this.pending.get(id);
  }

  /** The request a cluster's chat waits on, for the snapshot. */
  requestOf(clusterId: string): CliApprovalRequest | undefined {
    return [...this.pending.values()].find((pending) => pending.clusterId === clusterId)?.request;
  }

  /** Settles an approval with the user's answer; false when it no longer waits. */
  answer(id: string, confirmed: boolean): boolean {
    const pending = this.pending.get(id);
    pending?.settle(confirmed);
    return pending !== undefined;
  }

  /** Denies the approvals of a cluster, or of every cluster: Stop, New chat, a deactivation. */
  deny(clusterId?: string): void {
    for (const pending of [...this.pending.values()]) {
      if (clusterId === undefined || pending.clusterId === clusterId) pending.settle(false);
    }
  }

  /**
   * Checks every approval again under the profile of its cluster as it is
   * now: one the profile now denies is denied with the reason, and any other
   * stays pending until the user answers. One whose level or profile changed
   * is sent to the frames again, so the card shows them.
   */
  recheck(): void {
    for (const pending of [...this.pending.values()]) {
      const check = pending.checkNow();
      if ("block" in check) {
        pending.settle(false, check.block);
      } else if (check.level !== pending.request.level || check.profileName !== pending.request.profileName) {
        pending.request = { ...pending.request, ...check };
        this.send(pending.clusterId, pending.sessionId, { kind: "ui_request", payload: pending.request });
      }
    }
  }

  /**
   * Sends the request to the frames and waits for the answer. A run aborted
   * some other way than our Stop denies the approval too, so the hook never
   * hangs.
   */
  async ask(
    clusterId: string,
    sessionId: string,
    signal: AbortSignal | undefined,
    request: CliApprovalRequest,
    checkNow: () => ApprovalCheck,
  ): Promise<ToolCallEventResult | undefined> {
    if (signal?.aborted) return { block: true, reason: DENIED_REASON };
    const answer = await new Promise<{ confirmed: boolean; reason: string }>((resolve) => {
      const onAbort = () => settle(false);
      const settle = (confirmed: boolean, reason = DENIED_REASON) => {
        if (!this.pending.delete(request.id)) return;
        signal?.removeEventListener("abort", onAbort);
        this.send(clusterId, sessionId, { kind: "ui_resolved", payload: { id: request.id, confirmed } });
        resolve({ confirmed, reason });
      };
      this.pending.set(request.id, { clusterId, sessionId, request, settle, checkNow });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.send(clusterId, sessionId, { kind: "ui_request", payload: request });
    });
    return answer.confirmed ? undefined : { block: true, reason: answer.reason };
  }
}

/** What the gate of a chat reads from the agent host, when it needs it. */
export interface CliGateOptions {
  clusterId: string;
  runCli: CliRunner;
  /** The cluster's connection status in the Freelens catalog; read before every call. */
  getClusterStatus: (clusterId: string) => string | undefined;
  /** The cluster's policy profile as it is now. */
  getPolicyProfile: () => PolicyProfile;
  /** The "pod logs tail lines" preference. */
  getPodLogsTailLines: () => number;
  /** Whether "Approve all in this chat" is on. */
  isApprovingAll: () => boolean;
  /** Shows a message on the card of a call, as the tool's own progress does. */
  showProgress: (event: ToolCallEvent, message: string) => void;
  /** Asks the user about a call, through the chat's pending approvals. */
  askUser: (
    signal: AbortSignal | undefined,
    request: CliApprovalRequest,
    checkNow: () => ApprovalCheck,
  ) => Promise<ToolCallEventResult | undefined>;
}

/** What the gate decided about a call it let through, for the tool that runs it. */
interface PassedCliCall {
  program: CliProgram;
  secretRedaction?: SecretRedaction;
}

/**
 * The gate of one chat's session. It keeps the cluster's resources for the
 * session and the calls it let through, by tool call id, until they run.
 */
export class CliGate {
  private readonly clusterResources = new ClusterResourceCache();
  private readonly passedCalls = new Map<string, PassedCliCall>();

  constructor(private readonly options: CliGateOptions) {}

  /** pi's `tool_call` hook. pi asks for one call at a time. */
  async check(event: ToolCallEvent, signal: AbortSignal | undefined): Promise<ToolCallEventResult | undefined> {
    const program = CLI_TOOL_PROGRAMS.get(event.toolName);
    if (!program) return undefined;
    const { clusterId, getPolicyProfile } = this.options;
    // Not even the gate's own invocations start for a cluster that is not connected.
    if (this.options.getClusterStatus(clusterId) !== CONNECTED) return { block: true, reason: CLUSTER_NOT_CONNECTED };
    const input = event.input as unknown as CliToolInput;
    const prepared = prepareCliInvocation(program, input, this.options.getPodLogsTailLines());
    if (!prepared.ok) return { block: true, reason: prepared.error };

    const profile = getPolicyProfile();
    const read: ClusterReadContext = {
      clusterId,
      runCli: this.options.runCli,
      signal,
      // The kubectl download, if any, happens in the gate's first invocation:
      // it shows on the call's card as the tool's own progress does.
      onProgress: (message) => this.options.showProgress(event, message),
    };
    let decision: InvocationPolicyResult;
    try {
      decision = await this.clusterResources.evaluate(read, (resources) =>
        evaluateCliCall(program, input, profile, resources),
      );
    } catch (error) {
      return { block: true, reason: `Could not read the resources the cluster serves: ${errorText(error)}` };
    }
    if (decision.kind === "floor") return { block: true, reason: floorBlockReason(decision) };
    if (decision.level === "deny") return { block: true, reason: profileDenyReason(profile, decision) };
    const secretRedaction = planSecretRedaction(program, input.args, decision.targets);
    const pass = () => {
      this.passedCalls.set(event.toolCallId, { program, ...(secretRedaction ? { secretRedaction } : {}) });
      return undefined;
    };
    if (decision.level === "allow") return pass();
    if (decision.level === "ask" && this.options.isApprovingAll()) return pass();

    // Before asking, the server's dry run of a verb that has one: a change the
    // server rejects fails without a card, with the server's message.
    const resources = this.clusterResources.current;
    const dryRunVerb = DRY_RUN_VERBS[program].find((verb) =>
      decision.targets.some((target) => target.form.verb === verb.verb),
    );
    const [firstTarget] = decision.targets;
    let preview: CliApprovalPreview | undefined;
    if (dryRunVerb && resources && firstTarget) {
      const outcome =
        program === "helm"
          ? await previewHelmInvocation(read, { args: prepared.args, verb: dryRunVerb, target: firstTarget.form })
          : await previewKubectlInvocation(read, {
              args: prepared.args,
              ...(prepared.manifest === undefined ? {} : { manifest: prepared.manifest }),
              verb: dryRunVerb,
              targets: decision.targets.map((target) => target.form),
              catalog: resources.catalog,
            });
      if (outcome.kind === "stopped") return { block: true, reason: DENIED_REASON };
      if (outcome.kind === "rejected") return { block: true, reason: dryRunRejectionReason(outcome.message) };
      preview = outcome.preview;
    }

    // The call is evaluated again with the resources it was evaluated with
    // when the profiles change: after the dry run, which may take a while, and
    // while the approval waits.
    const checkNow = (): ApprovalCheck => {
      const current = getPolicyProfile();
      return resources
        ? approvalCheck(current, evaluateCliCall(program, input, current, resources))
        : approvalCheck(profile, decision);
    };
    const check = checkNow();
    if ("block" in check) return { block: true, reason: check.block };
    const request: CliApprovalRequest = {
      id: randomUUID(),
      toolCallId: event.toolCallId,
      method: "confirm",
      program,
      args: [...input.args],
      ...(input.manifest === undefined ? {} : { manifest: input.manifest }),
      canonicalForms: decision.targets.map((target) => target.form),
      ...check,
      ...(preview ? { preview } : {}),
    };
    return (await this.options.askUser(signal, request, checkNow)) ?? pass();
  }

  /** The pi tool of a CLI tool: it runs a call through the CLI runner, and only a call the gate let through. */
  toPiTool(tool: AgentToolDefinition) {
    const program = CLI_TOOL_PROGRAMS.get(tool.name);
    if (!program) throw new Error(`No runner for the tool ${tool.name}`);
    const { clusterId } = this.options;
    return defineTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal, onUpdate) => {
        // No process starts for a cluster that is not connected.
        if (this.options.getClusterStatus(clusterId) !== CONNECTED) {
          throw new Error(CLUSTER_NOT_CONNECTED);
        }
        const passed = this.passedCalls.get(toolCallId);
        this.passedCalls.delete(toolCallId);
        if (passed?.program !== program) throw new Error("The invocation policy has not checked this call.");
        const result = await runCliTool(params as CliToolInput, {
          ...passed,
          clusterId,
          runCli: this.options.runCli,
          signal,
          podLogsTailLines: this.options.getPodLogsTailLines(),
          onProgress: (message) => onUpdate?.({ content: [{ type: "text", text: message }], details: undefined }),
        });
        return { content: [{ type: "text", text: result.text }], details: result.details, isError: result.isError };
      },
    });
  }
}
