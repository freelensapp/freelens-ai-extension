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
          components={{
            code: (props) => markDownHook.renderCode(props.inline, props.className, props.children, props),
            a: (props) => markDownHook.renderLinks(props.href, props.children, props),
          }}
        />
      </div>
    </>
  );
};
