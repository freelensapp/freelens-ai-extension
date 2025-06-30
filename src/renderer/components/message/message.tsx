import { Renderer } from "@freelensapp/extensions";
import { getTextMessage } from "../../business/objects/message-object-provider";
import { MessageType } from "../../business/objects/message-type";
import { useChatHook } from "../chat";
import { MarkdownViewer } from "../markdown-viewer";
import styleInline from "./message.scss?inline";

import type { PreferencesStore } from "../../../common/store";
import type { MessageObject } from "../../business/objects/message-object";

const {
  Component: { Button },
} = Renderer;

export interface MessageProps {
  message: MessageObject;
  preferencesStore: PreferencesStore;
}

export const Message = ({ message, preferencesStore }: MessageProps) => {
  const sentMessageClassName = message.sent ? "message-bubble sent" : "message-bubble";
  const buttonsOptionsClassName = "message-buttons-options";
  const chatHook = useChatHook(preferencesStore);

  const renderOptions = (options?: string[]) => {
    return (
      options &&
      options.map((option) => (
        <Button label={option} onClick={() => chatHook.sendMessageToAgent(getTextMessage(option, true))} />
      ))
    );
  };

  return (
    <>
      <style>{styleInline}</style>
      {message.sent ? (
        <div className={sentMessageClassName}>{message.text}</div>
      ) : (
        <div>
          <MarkdownViewer content={message.text} />
          <div className={buttonsOptionsClassName}>
            {MessageType.INTERRUPT === message.type && renderOptions(message.options)}
          </div>
        </div>
      )}
    </>
  );
};
