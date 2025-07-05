import { CodeBlock } from "../code-block";

import type { HTMLAttributes, ReactNode } from "react";

export const useMarkDownViewerHook = () => {
  const getLanguage = (className?: string) => {
    if (!className) {
      return;
    }
    const match = /language-(\w+)/.exec(className);
    return match?.[1];
  };

  const renderCode = (
    inline?: boolean,
    className?: string,
    children?: ReactNode,
    props?: HTMLAttributes<HTMLElement>,
  ) => {
    const language = getLanguage(className);
    return (
      <CodeBlock inline={inline} language={language} props={props ?? {}}>
        {children}
      </CodeBlock>
    );
  };

  const renderLinks = (href?: string, children?: ReactNode, props?: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    return (
      <a href={href} target="_blank" {...props} style={{ color: "var(--blue)" }}>
        {children}
      </a>
    );
  };

  return { renderCode, renderLinks };
};
