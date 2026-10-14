import { Loader2, ShieldOff } from "lucide-react";
import { getTextMessage } from "../../business/objects/message-object-provider";
import { useApplicationStatusStore } from "../../context/application-context";
import { Message } from "../message";
import { TextInput } from "../text-input";
import styleInline from "./chat.scss?inline";
import { useChatHook } from "./chat-hook";

import type { MessageObject } from "../../business/objects/message-object";

export const Chat = () => {
  const applicationStatusStore = useApplicationStatusStore();
  const chatHook = useChatHook();

  return (
    <>
      <style>{styleInline}</style>
      {/* "Approve all in this chat" is on in main */}
      {applicationStatusStore.autoApproveAll && (
        <div className="auto-approve-notice" title="Changes to the cluster run without asking for approval">
          <ShieldOff size={16} />
          Approving all actions in this chat
          <button
            type="button"
            className="auto-approve-notice-button"
            onClick={() => applicationStatusStore.turnOffAutoApprove()}
          >
            Turn off
          </button>
        </div>
      )}
      <div className="chat-container">
        <div className="messages-container" ref={chatHook.containerRef}>
          {applicationStatusStore.chatMessages?.map((msg: MessageObject, index: number) => (
            <Message key={index} message={msg} />
          ))}

          {/* Spinner that executes while the agent is running */}
          {applicationStatusStore.isLoading && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                margin: "16px 0",
              }}
            >
              <Loader2 size={32} className="chat-loading-spinner" />
            </div>
          )}
        </div>

        <TextInput onSend={(text) => chatHook.sendMessageToAgent(getTextMessage(text, true))} />
      </div>
    </>
  );
};
