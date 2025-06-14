// @ts-ignore
import React from "react";

import { Copy, Play } from "lucide-react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { useCodeBlockHook } from "./code-block-hook";

import styleInline from "./code-block.scss?inline";

type CodeBlockProps = {
  inline: boolean;
  children: string;
  language: string;
  props: any;
};

export const CodeBlock = ({ inline, children, language, props }: CodeBlockProps) => {
  const codeBlockHook = useCodeBlockHook({ children });

  if (!inline) {
    return (
      <>
        <style>{styleInline}</style>
        <div className="code-block-container">
          <div className={"code-block-toolbar"}>
            <button onClick={codeBlockHook.executeCommand} className={"code-block-button code-block-run-button"}>
              {codeBlockHook.isExecutable(language) && <Play size={16} />}
            </button>

            <div className={"code-block-toolbar-language"}>{language}</div>

            <button onClick={codeBlockHook.handleCopy} className={"code-block-button code-block-copy-button"}>
              {codeBlockHook.copied && <span className="code-block-copied-text">Copied!</span>}
              <Copy size={16} />
            </button>
          </div>
          <SyntaxHighlighter
            PreTag="div"
            language={language}
            customStyle={{
              margin: 0,
              borderBottomLeftRadius: "0.5rem",
              borderBottomRightRadius: "0.5rem",
              backgroundColor: "var(--layoutTabsLineColor)",
            }}
            showLineNumbers={codeBlockHook.hasMultipleLines}
            showInlineLineNumbers={codeBlockHook.hasMultipleLines}
          >
            {codeBlockHook.text}
          </SyntaxHighlighter>
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
