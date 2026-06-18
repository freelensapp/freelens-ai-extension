import { Loader2 } from "lucide-react";
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
      {/* Bypass approvals mode indicator */}
      {applicationStatusStore.bypassApprovals && (
        <div
          style={{
            position: "absolute",
            top: 18,
            right: 18,
            zIndex: 10,
            background: "linear-gradient(90deg,#E0A800 60%,#FFC107 100%)",
            color: "#fff",
            borderRadius: 16,
            padding: "8px 20px",
            fontWeight: 700,
            fontSize: 16,
            boxShadow: "0 2px 12px rgba(224,168,0,0.25)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            letterSpacing: 1,
            border: "2px solid #E0A800",
          }}
          title="Tool-use approval prompts are auto-approved"
        >
          <span style={{ fontSize: 22, marginRight: 8 }}>⚠️</span>
          Bypass Approvals Mode
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
