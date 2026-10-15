import { createContext, useContext } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./markdown-viewer.module.scss";
import { useMarkDownViewerHook } from "./markdown-viewer-hook";

import type { ComponentPropsWithoutRef } from "react";
import type { Components, ExtraProps } from "react-markdown";

type MarkdownViewerProps = {
  content: string;
};

// react-markdown tells a code renderer nothing about where the code is: a
// fenced block is a `code` element inside a `pre`, inline code is not. The
// `pre` renderer marks its content as a block for the `code` renderer.
const InCodeBlock = createContext(false);

// Renderers receive the syntax tree's `node` next to the element's attributes;
// only the attributes are passed on, since React rejects `node` on a DOM
// element. They are defined here, not in the render, so that a new answer does
// not remount every code block.
const MarkdownPre = ({ node: _node, ...props }: ComponentPropsWithoutRef<"pre"> & ExtraProps) => (
  <InCodeBlock.Provider value={true}>
    <pre {...props} />
  </InCodeBlock.Provider>
);

const MarkdownCode = ({
  className,
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"code"> & ExtraProps) => {
  const inline = !useContext(InCodeBlock);
  return useMarkDownViewerHook().renderCode(inline, className, children, props);
};

const MarkdownLink = ({ href, children, node: _node, ...props }: ComponentPropsWithoutRef<"a"> & ExtraProps) =>
  useMarkDownViewerHook().renderLinks(href, children, props);

const components: Components = { pre: MarkdownPre, code: MarkdownCode, a: MarkdownLink };

export const MarkdownViewer = ({ content }: MarkdownViewerProps) => (
  <div className={styles.markdownViewerContainerTheme}>
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </Markdown>
  </div>
);
