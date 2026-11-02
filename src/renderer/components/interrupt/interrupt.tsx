import { Renderer } from "@freelensapp/extensions";
import { CheckCircle, TriangleAlert, XCircle } from "lucide-react";
import * as React from "react";
import { formatCanonicalForm } from "../../../common/invocation-policy/canonical-form";
import { POLICY_LEVEL_LABELS } from "../../../common/invocation-policy/policy-profile";
import { CodeBlock } from "../code-block";
import { MarkdownViewer } from "../markdown-viewer";
import styles from "./interrupt.module.scss";

import type { CliApprovalRequest } from "../../../common/agent-protocol";

const {
  Component: { Button },
} = Renderer;

export type InterruptProps = {
  header: string;
  question: string;
  text: string;
  actionDetails?: string;
  resources?: string;
  // The approval of a kubectl call: its targets, its level and its manifest.
  cliApproval?: CliApprovalRequest;
  options: string[];
  approved: boolean | null;
  onAction: (option: string) => void;
};

const levelLine = ({ level, profileName }: CliApprovalRequest) =>
  level === "alwaysAsk"
    ? `${POLICY_LEVEL_LABELS.alwaysAsk}: the policy profile ${profileName} asks before this invocation every time, even with "Approve all in this chat".`
    : `${POLICY_LEVEL_LABELS.ask}: the policy profile ${profileName} asks before this invocation.`;

// The body of a kubectl call's card, under its command line: one target per
// resource, name or manifest object, the level and the profile that gave it,
// whether Secret values go to the model, and the manifest the call sends.
const CliApprovalBody = ({ request }: { request: CliApprovalRequest }) => (
  <>
    <div className={styles.interruptLabel}>Targets</div>
    <ul className={styles.interruptTargets}>
      {request.canonicalForms.map((form, index) => (
        <li key={index}>
          <code>{formatCanonicalForm(form)}</code>
        </li>
      ))}
    </ul>
    <div className={styles.interruptLevel}>{levelLine(request)}</div>
    {request.canonicalForms.some((form) => form.verb === "reveal") && (
      <div className={styles.interruptLevel}>
        Reveal: the values of these Secrets will be sent to the model unredacted.
      </div>
    )}
    {request.manifest !== undefined && (
      <CodeBlock language="yaml" title="Manifest" collapsible props={{}}>
        {request.manifest}
      </CodeBlock>
    )}
  </>
);

const Interrupt = ({
  header,
  question,
  text,
  actionDetails,
  resources,
  cliApproval,
  options,
  approved,
  onAction,
}: InterruptProps) => {
  const pending = approved === null;
  const [detailsOpen, setDetailsOpen] = React.useState(false);

  // Structured Kubernetes approvals carry the action payload and a backup of the
  // resources to be changed as YAML; other interrupts fall back to markdown text.
  const renderBody = () =>
    cliApproval ? (
      <CliApprovalBody request={cliApproval} />
    ) : actionDetails ? (
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
            <TriangleAlert className={`${styles.interruptStatusIcon} ${styles.interruptStatusPending}`} />
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
                key={option}
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
