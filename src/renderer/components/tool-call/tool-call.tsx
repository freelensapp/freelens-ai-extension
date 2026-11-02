import { Loader2, Wrench, XCircle } from "lucide-react";
import { helmTool, kubectlTool } from "../../../common/agent-tools";
import { formatCommandLine } from "../../business/cli/command-line";
import styles from "./tool-call.module.scss";

import type { ToolCallView } from "../../../common/objects/message-object";

export interface ToolCallProps {
  toolCall: ToolCallView;
}

const isFailed = (toolCall: ToolCallView) => !toolCall.running && toolCall.isError === true;

// What the call is doing, or how it ended when that is not plain success.
const statusOf = (toolCall: ToolCallView) =>
  toolCall.running
    ? (toolCall.progress ?? "running")
    : toolCall.result === undefined
      ? "not run"
      : isFailed(toolCall)
        ? "failed"
        : undefined;

const ToolCallIcon = ({ toolCall }: ToolCallProps) => {
  const failed = isFailed(toolCall);
  const Icon = toolCall.running ? Loader2 : failed ? XCircle : Wrench;
  return (
    <Icon
      size={14}
      className={`${styles.toolCallIcon}${toolCall.running ? ` ${styles.toolCallRunning}` : ""}${
        failed ? ` ${styles.toolCallFailed}` : ""
      }`}
    />
  );
};

/** The tools whose calls are CLI invocations, shown as their command lines. */
const CLI_TOOL_NAMES: ReadonlySet<string> = new Set([kubectlTool.name, helmTool.name]);

// The arguments and the manifest the model called kubectl or helm with.
const cliInput = (args: unknown): { args: string[]; manifest?: string } => {
  const input = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  return {
    args: Array.isArray(input.args) ? input.args.filter((arg): arg is string => typeof arg === "string") : [],
    ...(typeof input.manifest === "string" ? { manifest: input.manifest } : {}),
  };
};

// A kubectl or helm call that failed without running: the floor, the profile or the
// user blocked it, or it could not start. Its result is the reason.
const isBlocked = (toolCall: ToolCallView) => isFailed(toolCall) && !toolCall.invocation;

const outputLabel = (toolCall: ToolCallView) => {
  if (!toolCall.invocation) return "Output";
  const { exitCode } = toolCall.invocation;
  return exitCode === null ? "Output, killed before it ended" : `Output, exit code ${exitCode}`;
};

// A kubectl or helm call as its command line, the arguments it ran with once
// it has run; the manifest and the output unfold under it. The reason of a
// blocked call shows under the line.
const CliCall = ({ toolCall }: ToolCallProps) => {
  const input = cliInput(toolCall.args);
  const commandLine = formatCommandLine(toolCall.toolName, toolCall.invocation?.args ?? input.args);
  const blocked = isBlocked(toolCall);
  const status = blocked ? "blocked" : statusOf(toolCall);
  const failed = isFailed(toolCall);

  return (
    <div className={styles.toolCall}>
      <div className={styles.toolCallLine}>
        <ToolCallIcon toolCall={toolCall} />
        <code className={styles.toolCallCommand}>{commandLine}</code>
        {status && <span className={styles.toolCallStatus}>{status}</span>}
      </div>
      {input.manifest !== undefined && (
        <details className={styles.toolCallFold}>
          <summary className={styles.toolCallFoldSummary}>Manifest</summary>
          <pre className={styles.toolCallText}>{input.manifest}</pre>
        </details>
      )}
      {blocked && <div className={`${styles.toolCallReason} ${styles.toolCallFailed}`}>{toolCall.result}</div>}
      {toolCall.result !== undefined && !blocked && (
        <details className={styles.toolCallFold}>
          <summary className={styles.toolCallFoldSummary}>{outputLabel(toolCall)}</summary>
          <pre className={`${styles.toolCallText}${failed ? ` ${styles.toolCallFailed}` : ""}`}>{toolCall.result}</pre>
        </details>
      )}
    </div>
  );
};

// A kubectl or helm call shows as its command line. A call of any other tool, such as
// one of the cluster tools of an earlier version in a saved chat, shows as one
// line with the tool's name and arguments; the arguments in full and the result
// unfold under it.
export const ToolCall = ({ toolCall }: ToolCallProps) => {
  if (CLI_TOOL_NAMES.has(toolCall.toolName)) return <CliCall toolCall={toolCall} />;
  const args = toolCall.args ?? {};
  const failed = isFailed(toolCall);
  const status = statusOf(toolCall);

  return (
    <details className={styles.toolCall}>
      <summary className={styles.toolCallSummary}>
        <ToolCallIcon toolCall={toolCall} />
        <span className={styles.toolCallName}>{toolCall.toolName}</span>
        <span className={styles.toolCallArgs}>{JSON.stringify(args)}</span>
        {status && <span className={styles.toolCallStatus}>{status}</span>}
      </summary>
      <div className={styles.toolCallLabel}>Arguments</div>
      <pre className={styles.toolCallText}>{JSON.stringify(args, null, 2)}</pre>
      {toolCall.result !== undefined && (
        <>
          <div className={styles.toolCallLabel}>{failed ? "Error" : "Result"}</div>
          <pre className={`${styles.toolCallText}${failed ? ` ${styles.toolCallFailed}` : ""}`}>{toolCall.result}</pre>
        </>
      )}
    </details>
  );
};
