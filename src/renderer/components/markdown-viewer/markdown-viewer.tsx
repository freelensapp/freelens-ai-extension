// @ts-ignore
import React from "react";

import Markdown from "react-markdown";
import { useMarkDownViewerHook } from "./markdown-viewer-hook";

import styleInline from "./markdown-viewer.scss";

type MarkdownViewerProps = {
  content: string;
};

export const MarkdownViewer = ({ content }: MarkdownViewerProps) => {
  const markDownHook = useMarkDownViewerHook();

  return (
    <>
      <style>{styleInline}</style>
      <div className="markdown-viewer-container-theme">
        <Markdown
          children={content}
          components={{
            code: (props) => markDownHook.renderCode(props.inline, props.className, props.children, props),
            a: (props) => markDownHook.renderLinks(props.href, props.children, props),
          }}
        />
      </div>
    </>
  );
};
