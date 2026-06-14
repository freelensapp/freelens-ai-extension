import useChatService from "../../../common/service/chat-service";
import { getTextMessage } from "../../business/objects/message-object-provider";
import { MessageType } from "../../business/objects/message-type";
import Interrupt from "../interrupt/interrupt";
import { MarkdownViewer } from "../markdown-viewer";
import styleInline from "./message.scss?inline";
import useMessageHook from "./message-hook";

import type { MessageObject } from "../../business/objects/message-object";

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
            options={message.options!}
            approved={message.approved!}
            onAction={(option) => {
              if ("yes" === option) {
                chatService.changeInterruptStatus(message.messageId, true);
              } else if ("no" === option) {
                chatService.changeInterruptStatus(message.messageId, false);
              }
              chatService.sendMessageToAgent(getTextMessage(option, true));
            }}
          />
        </>
      );
    } else {
      return (
        <div>
          <style>{styleInline}</style>
          <MarkdownViewer content={chatHook.visibleText} />
        </div>
      );
    }
  }
};
