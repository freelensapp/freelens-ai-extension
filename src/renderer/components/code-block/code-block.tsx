import { Renderer } from "@freelensapp/extensions";
import { ChevronDown, ChevronRight, Copy, Play } from "lucide-react";
import { useState } from "react";
import styleInline from "./code-block.scss?inline";
import { useCodeBlockHook } from "./code-block-hook";

import type { ReactNode } from "react";

const {
  Component: { MonacoEditor },
} = Renderer;

type CodeBlockProps = {
  inline?: boolean;
  children: ReactNode;
  language?: string;
  // Replaces the language label in the toolbar (for example "Action details").
  title?: string;
  // When set, the toolbar title becomes a toggle that folds the code body.
  collapsible?: boolean;
  // Initial folded state when collapsible (default: expanded).
  defaultCollapsed?: boolean;
  props: React.HTMLAttributes<HTMLElement>;
};

export const CodeBlock = ({
  inline,
  children,
  language,
  title,
  collapsible,
  defaultCollapsed,
  props,
}: CodeBlockProps) => {
  const codeBlockHook = useCodeBlockHook({ children });
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);

  if (!inline) {
    const label = title ?? language;
    const bodyHidden = collapsible && collapsed;
    return (
      <>
        <style>{styleInline}</style>
        <div className="code-block-container">
          <div className={`code-block-toolbar${bodyHidden ? " code-block-toolbar-collapsed" : ""}`}>
            <button onClick={codeBlockHook.executeCommand} className={"code-block-button code-block-run-button"}>
              {codeBlockHook.isExecutable(language) && <Play size={16} />}
            </button>

            {collapsible ? (
              <button
                type="button"
                onClick={() => setCollapsed((value) => !value)}
                className={"code-block-button code-block-toolbar-language code-block-toggle"}
              >
                {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                <span>{label}</span>
              </button>
            ) : (
              <div className={"code-block-toolbar-language"}>{label}</div>
            )}

            <button onClick={codeBlockHook.handleCopy} className={"code-block-button code-block-copy-button"}>
              {codeBlockHook.copied && <span className="code-block-copied-text">Copied!</span>}
              <Copy size={16} />
            </button>
          </div>
          {!bodyHidden && (
            <MonacoEditor
              readOnly
              className="code-block-editor"
              language={codeBlockHook.getMonacoLanguage(language)}
              value={codeBlockHook.text}
              setInitialHeight
              style={{ minHeight: codeBlockHook.getEditorMinHeight() }}
              options={{
                scrollbar: {
                  alwaysConsumeMouseWheel: false,
                },
              }}
            />
          )}
        </div>
      </>
    );
  } else {
    return (
      <>
        <style>{styleInline}</style>
        <code className="code-block-inline-container" {...props}>
          {children}
        </code>
      </>
    );
  }
};
