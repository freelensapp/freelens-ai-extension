import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./markdown-viewer.module.scss";
import { useMarkDownViewerHook } from "./markdown-viewer-hook";

type MarkdownViewerProps = {
  content: string;
};

export const MarkdownViewer = ({ content }: MarkdownViewerProps) => {
  const markDownHook = useMarkDownViewerHook();

  return (
    <>
      <div className={styles.markdownViewerContainerTheme}>
        <Markdown
          children={content}
          remarkPlugins={[remarkGfm]}
          // react-markdown hands a custom renderer `inline` and the syntax tree's
          // `node` next to the element's attributes; only the attributes are
          // passed on, since React rejects the others on a DOM element.
          components={{
            code: ({ inline, className, children, node: _node, ...props }) =>
              markDownHook.renderCode(inline, className, children, props),
            a: ({ href, children, node: _node, ...props }) => markDownHook.renderLinks(href, children, props),
          }}
        />
      </div>
    </>
  );
};
