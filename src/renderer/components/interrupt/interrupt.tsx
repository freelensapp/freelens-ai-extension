import { Renderer } from "@freelensapp/extensions";
import { CheckCircle, XCircle } from "lucide-react";
import * as React from "react";
import { MarkdownViewer } from "../markdown-viewer";
import styleInline from "./interrupt.scss?inline";

const {
  Component: { Button },
} = Renderer;

export type InterruptProps = {
  header: string;
  question: string;
  text: string;
  options: string[];
  approved: boolean | null;
  onAction: (option) => void;
};

const Interrupt = ({ header, question, text, options, approved, onAction }: InterruptProps) => {
  const pending = approved === null;
  const [detailsOpen, setDetailsOpen] = React.useState(false);

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
        {pending && <div className="interrupt-question">{question}</div>}
      </div>
      {pending && (
        <>
          <MarkdownViewer content={text} />
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
      {!pending && detailsOpen && (
        <div className="interrupt-details">
          {question && <div className="interrupt-question">{question}</div>}
          <MarkdownViewer content={text} />
        </div>
      )}
    </div>
  );
};

export default Interrupt;
