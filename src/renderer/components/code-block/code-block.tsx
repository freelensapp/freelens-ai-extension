import { Renderer } from "@freelensapp/extensions";
import { ChevronDown, ChevronRight, Copy, ListPlus, ListX, Play } from "lucide-react";
import { useState } from "react";
import styles from "./code-block.module.scss";
import { useCodeBlockHook } from "./code-block-hook";

import type { HTMLAttributes, ReactNode } from "react";

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
  props: HTMLAttributes<HTMLElement>;
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
  const codeBlockHook = useCodeBlockHook({ children, language });
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);

  if (!inline) {
    const label = title ?? language;
    const bodyHidden = collapsible && collapsed;
    return (
      <>
        <div className={styles.codeBlockContainer}>
          <div className={`${styles.codeBlockToolbar}${bodyHidden ? ` ${styles.codeBlockToolbarCollapsed}` : ""}`}>
            <button
              onClick={codeBlockHook.executeCommand}
              className={`${styles.codeBlockButton} ${styles.codeBlockRunButton}`}
            >
              {codeBlockHook.isExecutable(language) && <Play size={16} />}
            </button>

            {collapsible ? (
              <button
                type="button"
                onClick={() => setCollapsed((value) => !value)}
                className={`${styles.codeBlockButton} ${styles.codeBlockToolbarLanguage} ${styles.codeBlockToggle}`}
              >
                {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                <span>{label}</span>
              </button>
            ) : (
              <div className={styles.codeBlockToolbarLanguage}>{label}</div>
            )}

            <div className={styles.codeBlockToolbarActions}>
              {codeBlockHook.hasManagedFields && (
                <button
                  type="button"
                  onClick={codeBlockHook.toggleManagedFields}
                  className={`${styles.codeBlockButton} ${styles.codeBlockManagedFieldsButton}`}
                  title={codeBlockHook.managedFieldsHidden ? "Show managedFields" : "Hide managedFields"}
                >
                  {codeBlockHook.managedFieldsHidden ? <ListPlus size={16} /> : <ListX size={16} />}
                </button>
              )}

              <button
                onClick={codeBlockHook.handleCopy}
                className={`${styles.codeBlockButton} ${styles.codeBlockCopyButton}`}
              >
                {codeBlockHook.copied && <span className={styles.codeBlockCopiedText}>Copied!</span>}
                <Copy size={16} />
              </button>
            </div>
          </div>
          {!bodyHidden && (
            <MonacoEditor
              readOnly
              className={styles.codeBlockEditor}
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
        <code className={styles.codeBlockInlineContainer} {...props}>
          {children}
        </code>
      </>
    );
  }
};
