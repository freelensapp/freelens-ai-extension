import { RotateCcw } from "lucide-react";
import { MessageType } from "../../../common/objects/message-type";
import { APPROVE_ALL_OPTION } from "../../business/agent-client/chat-reducer";
import useChatService from "../chat/chat-service";
import Interrupt from "../interrupt/interrupt";
import { MarkdownViewer } from "../markdown-viewer";
import styleInline from "./message.scss?inline";
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
        <style>{styleInline}</style>
        <div className={chatHook.sentMessageClassName}>{message.text}</div>
      </>
    );
  } else {
    if (MessageType.INTERRUPT === message.type) {
      return (
        <>
          <style>{styleInline}</style>
          <Interrupt
            header={message.action!}
            question={message.question!}
            text={message.text}
            actionDetails={message.actionDetails}
            resources={message.resources}
            options={message.options!}
            approved={message.approved!}
            onAction={(option) => {
              if (!message.approvalId) return;
              const approveAll = option === APPROVE_ALL_OPTION;
              void chatService.answerApproval(message.approvalId, option === "yes" || approveAll, approveAll);
            }}
          />
        </>
      );
    } else if (message.notice) {
      return (
        <div className="notice-message">
          <style>{styleInline}</style>
          {message.text}
        </div>
      );
    } else if (message.error) {
      return (
        <div className="error-message">
          <style>{styleInline}</style>
          <MarkdownViewer content={chatHook.visibleText} />
          <button type="button" className="retry-button" onClick={() => chatService.retry(message)}>
            <RotateCcw size={14} />
            Retry
          </button>
        </div>
      );
    } else {
      return (
        <div>
          <style>{styleInline}</style>
          {chatHook.reasoning && (
            <details
              className="reasoning-details"
              open={chatHook.reasoningOpen}
              onToggle={(event) => chatHook.setReasoningOpen((event.target as HTMLDetailsElement).open)}
            >
              <summary className="reasoning-summary">Reasoning</summary>
              <div className="reasoning-content">{chatHook.reasoning}</div>
            </details>
          )}
          <MarkdownViewer content={chatHook.visibleText} />
        </div>
      );
    }
  }
};
