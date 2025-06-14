// @ts-ignore
import React from "react";

import { Renderer } from "@freelensapp/extensions";
import { MessageObject } from "../../../common/business/objects/message-object";
import { getTextMessage } from "../../../common/business/objects/message-object-provider";
import { MessageType } from "../../../common/business/objects/message-type";
import { PreferencesStore } from "../../../common/store";
import { useChatHook } from "../chat";
import { MarkdownViewer } from "../markdown-viewer";

import styleInline from "./message.scss?inline";

const {
  Component: { Button },
} = Renderer;

export type MessageProps = {
  message: MessageObject;
  preferencesStore: PreferencesStore;
};

export const Message = ({ message, preferencesStore }: MessageProps) => {
  const sentMessageClassName = message.sent ? "message-bubble sent" : "message-bubble";
  const buttonsOptionsClassName = "message-buttons-options";
  const chatHook = useChatHook(preferencesStore);

  const renderOptions = (options: string[]) => {
    return options.map((option) => (
      <Button label={option} onClick={() => chatHook.sendMessageToAgent(getTextMessage(option, true))} />
    ));
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
