// What the dry-run previews of kubectl and helm share: how the gate runs their
// invocations and how a failed one is described on the card.

import { errorText } from "../../../common/agent-protocol";
import { GATE_INVOCATION_TIMEOUT_MS, runGateInvocation } from "./cluster-resources";

import type { CliApprovalPreview } from "../../../common/agent-protocol";
import type { CliProgram } from "../../../common/invocation-policy/canonical-form";
import type { CliResult } from "../cli-runner";
import type { ClusterReadContext } from "./cluster-resources";

export type PreviewOutcome =
  /** The server rejected the dry run: the call would fail the same way. */
  | { kind: "rejected"; message: string }
  /** pi's signal ended a preview invocation (Stop). */
  | { kind: "stopped" }
  | { kind: "preview"; preview: CliApprovalPreview };

/** Runs one invocation of a preview; a runner that cannot start the process answers like a failed process. */
export const runPreviewInvocation = async (
  context: ClusterReadContext,
  program: CliProgram,
  args: readonly string[],
  manifest?: string,
): Promise<CliResult> => {
  try {
    return await runGateInvocation(context, program, args, manifest);
  } catch (error) {
    return { stdout: "", stderr: errorText(error), exitCode: null };
  }
};

/** Why a preview invocation gave nothing to show: its timeout, or its error output. */
export const previewFailure = (what: string, result: CliResult): string => {
  if (result.killed === "timeout")
    return `${what} did not end within its timeout of ${GATE_INVOCATION_TIMEOUT_MS / 1000} s`;
  return `${what} failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`;
};
