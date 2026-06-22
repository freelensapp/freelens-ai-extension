import { Renderer } from "@freelensapp/extensions";
import { CheckCircle, XCircle } from "lucide-react";
import * as React from "react";
import { CodeBlock } from "../code-block";
import { MarkdownViewer } from "../markdown-viewer";
import styleInline from "./interrupt.scss?inline";

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
  onAction: (option) => void;
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
      <style>{styleInline}</style>
      <div className="interrupt-prompt">
        <div
          className={`interrupt-header${pending ? "" : " interrupt-header-toggle"}`}
          onClick={pending ? undefined : () => setDetailsOpen((open) => !open)}
        >
          {pending ? (
            <span className="interrupt-warning-icon">⚠️</span>
          ) : approved ? (
            <CheckCircle className="interrupt-status-icon interrupt-status-approved" />
          ) : (
            <XCircle className="interrupt-status-icon interrupt-status-rejected" />
          )}
          {header}
        </div>
      </div>
      {pending && (
        <>
          {renderBody()}
          <div className="interrupt-question">{question}</div>
          <div>
            {options.map((option) => (
              <Button
                className={`message-buttons-options ${
                  option === "yes" ? "interrupt-button-yes" : option === "no" ? "interrupt-button-no" : ""
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
      {!pending && detailsOpen && <div className="interrupt-details">{renderBody()}</div>}
    </div>
  );
};

export default Interrupt;
