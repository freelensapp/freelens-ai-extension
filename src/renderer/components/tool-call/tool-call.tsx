import { Loader2, Wrench, XCircle } from "lucide-react";
import styles from "./tool-call.module.scss";

import type { ToolCallView } from "../../../common/objects/message-object";

export interface ToolCallProps {
  toolCall: ToolCallView;
}

// One line with the tool's name and arguments; the arguments in full and the
// result unfold under it.
export const ToolCall = ({ toolCall }: ToolCallProps) => {
  const args = toolCall.args ?? {};
  const failed = !toolCall.running && toolCall.isError === true;
  const status = toolCall.running
    ? "running"
    : toolCall.result === undefined
      ? "not run"
      : failed
        ? "failed"
        : undefined;
  const Icon = toolCall.running ? Loader2 : failed ? XCircle : Wrench;

  return (
    <details className={styles.toolCall}>
      <summary className={styles.toolCallSummary}>
        <Icon
          size={14}
          className={`${styles.toolCallIcon}${toolCall.running ? ` ${styles.toolCallRunning}` : ""}${
            failed ? ` ${styles.toolCallFailed}` : ""
          }`}
        />
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
