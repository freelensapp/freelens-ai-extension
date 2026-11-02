import { Loader2, Wrench, XCircle } from "lucide-react";
import { kubectlTool } from "../../../common/agent-tools/kubectl-tool";
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

// An argument as a shell would read it back: quoted unless it holds only
// characters a shell leaves alone. The line is only shown; no shell runs it.
const quoteArg = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

// The arguments and the manifest the model called kubectl with.
const kubectlInput = (args: unknown): { args: string[]; manifest?: string } => {
  const input = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  return {
    args: Array.isArray(input.args) ? input.args.filter((arg): arg is string => typeof arg === "string") : [],
    ...(typeof input.manifest === "string" ? { manifest: input.manifest } : {}),
  };
};

const outputLabel = (toolCall: ToolCallView) => {
  if (!toolCall.invocation) return isFailed(toolCall) ? "Error" : "Output";
  const { exitCode } = toolCall.invocation;
  return exitCode === null ? "Output, killed before it ended" : `Output, exit code ${exitCode}`;
};

// A kubectl call as its command line, the arguments it ran with once it has
// run; the manifest and the output unfold under it.
const KubectlCall = ({ toolCall }: ToolCallProps) => {
  const input = kubectlInput(toolCall.args);
  const commandLine = [toolCall.toolName, ...(toolCall.invocation?.args ?? input.args)].map(quoteArg).join(" ");
  const status = statusOf(toolCall);
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
      {toolCall.result !== undefined && (
        <details className={styles.toolCallFold}>
          <summary className={styles.toolCallFoldSummary}>{outputLabel(toolCall)}</summary>
          <pre className={`${styles.toolCallText}${failed ? ` ${styles.toolCallFailed}` : ""}`}>{toolCall.result}</pre>
        </details>
      )}
    </div>
  );
};

// One line with the tool's name and arguments; the arguments in full and the
// result unfold under it. A kubectl call shows as its command line.
export const ToolCall = ({ toolCall }: ToolCallProps) => {
  if (toolCall.toolName === kubectlTool.name) return <KubectlCall toolCall={toolCall} />;
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
