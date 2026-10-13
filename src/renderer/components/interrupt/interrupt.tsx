import { Renderer } from "@freelensapp/extensions";
import { CheckCircle, XCircle } from "lucide-react";
import * as React from "react";
import { CodeBlock } from "../code-block";
import { MarkdownViewer } from "../markdown-viewer";
import styles from "./interrupt.module.scss";

const {
  Component: { Button },
} = Renderer;

export type InterruptProps = {
  header: string;
  question: string;
  text: string;
  actionDetails?: string;
  resources?: string;
  options: string[];
  approved: boolean | null;
  onAction: (option: string) => void;
};

const Interrupt = ({
  header,
  question,
  text,
  actionDetails,
  resources,
  options,
  approved,
  onAction,
}: InterruptProps) => {
  const pending = approved === null;
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  // Structured Kubernetes approvals carry the action payload and a backup of the
  // resources to be changed as YAML; other interrupts fall back to markdown text.
  const renderBody = () =>
    actionDetails ? (
      <>
        <CodeBlock language="yaml" title="Action details" collapsible props={{}}>
          {actionDetails}
        </CodeBlock>
        {resources && (
          <CodeBlock language="yaml" title="Resources that will be changed" collapsible defaultCollapsed props={{}}>
            {resources}
          </CodeBlock>
        )}
      </>
    ) : (
      <MarkdownViewer content={text} />
    );

  return (
    <div>
      <div className={styles.interruptPrompt}>
        <div
          className={`${styles.interruptHeader}${pending ? "" : ` ${styles.interruptHeaderToggle}`}`}
          onClick={pending ? undefined : () => setDetailsOpen((open) => !open)}
        >
          {pending ? (
            <span className={styles.interruptWarningIcon}>⚠️</span>
          ) : approved ? (
            <CheckCircle className={`${styles.interruptStatusIcon} ${styles.interruptStatusApproved}`} />
          ) : (
            <XCircle className={`${styles.interruptStatusIcon} ${styles.interruptStatusRejected}`} />
          )}
          {header}
        </div>
      </div>
      {pending && (
        <>
          {renderBody()}
          <div className={styles.interruptQuestion}>{question}</div>
          <div>
            {options.map((option) => (
              <Button
                className={`${styles.messageButtonsOptions} ${
                  option === "yes" ? styles.interruptButtonYes : option === "no" ? styles.interruptButtonNo : ""
                }`}
                label={option}
                onClick={() => {
                  onAction(option);
                }}
              />
            ))}
          </div>
        </>
      )}
      {!pending && detailsOpen && <div className={styles.interruptDetails}>{renderBody()}</div>}
    </div>
  );
};

export default Interrupt;
