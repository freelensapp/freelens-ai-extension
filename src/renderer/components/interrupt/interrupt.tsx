import { Renderer } from "@freelensapp/extensions";
import { CheckCircle, XCircle } from "lucide-react";
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
  return (
    <div>
      <style>{styleInline}</style>
      <div className="interrupt-prompt">
        <div className="interrupt-header">
          {approved === null ? (
            <span className="interrupt-warning-icon">⚠️</span>
          ) : approved ? (
            <CheckCircle className="interrupt-status-icon interrupt-status-approved" />
          ) : (
            <XCircle className="interrupt-status-icon interrupt-status-rejected" />
          )}
          {header}
        </div>
        {approved === null && <div className="interrupt-question">{question}</div>}
      </div>
      {approved === null ? (
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
      ) : (
        <details className="interrupt-details">
          <summary className="interrupt-details-summary">
            <span className="interrupt-details-summary-text">Show details</span>
          </summary>
          <MarkdownViewer content={text} />
        </details>
      )}
    </div>
  );
};

export default Interrupt;
