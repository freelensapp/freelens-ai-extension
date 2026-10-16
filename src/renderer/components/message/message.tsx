import { RotateCcw } from "lucide-react";
import { MessageType } from "../../../common/objects/message-type";
import useChatService from "../../business/service/chat-service";
import Interrupt from "../interrupt/interrupt";
import { MarkdownViewer } from "../markdown-viewer";
import styles from "./message.module.scss";
import useMessageHook from "./message-hook";

import type { MessageObject } from "../../../common/objects/message-object";

export interface MessageProps {
  message: MessageObject;
}

export const Message = ({ message }: MessageProps) => {
  const chatHook = useMessageHook({ message });
  const chatService = useChatService();

  if (message.sent) {
    return (
      <>
        <div className={chatHook.sentMessageClassName}>{message.text}</div>
      </>
    );
  } else {
    if (MessageType.INTERRUPT === message.type) {
      return (
        <>
          <Interrupt
            header={message.action!}
            question={message.question!}
            text={message.text}
            actionDetails={message.actionDetails}
            resources={message.resources}
            options={message.options!}
            approved={message.approved!}
            onAction={(option) => {
              if ("yes" === option) {
                chatService.changeInterruptStatus(message.messageId, true);
              } else if ("no" === option) {
                chatService.changeInterruptStatus(message.messageId, false);
              }
              chatService.resumeInterrupt(option);
            }}
          />
        </>
      );
    } else if (message.error) {
      return (
        <div className={styles.errorMessage}>
          <MarkdownViewer content={chatHook.visibleText} />
          {message.retryContext && (
            <button type="button" className={styles.retryButton} onClick={() => chatService.retry(message)}>
              <RotateCcw size={14} />
              Retry
            </button>
          )}
        </div>
      );
    } else {
      return (
        <div>
          {chatHook.reasoning && (
            <details
              className={styles.reasoningDetails}
              open={chatHook.reasoningOpen}
              onToggle={(event) => chatHook.setReasoningOpen((event.target as HTMLDetailsElement).open)}
            >
              <summary className={styles.reasoningSummary}>Reasoning</summary>
              <div className={styles.reasoningContent}>{chatHook.reasoning}</div>
            </details>
          )}
          <MarkdownViewer content={chatHook.visibleText} />
        </div>
      );
    }
  }
};
