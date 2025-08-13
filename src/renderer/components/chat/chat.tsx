import { Loader2 } from "lucide-react";
import { MessageObject } from "../../business/objects/message-object";
import { getTextMessage } from "../../business/objects/message-object-provider";
import { useApplicationStatusStore } from "../../context/application-context";
import { Message } from "../message";
import { TextInput } from "../text-input";
import styleInline from "./chat.scss?inline";
import { useChatHook } from "./chat-hook";

export const Chat = () => {
  const applicationStatusStore = useApplicationStatusStore();
  const chatHook = useChatHook();

  return (
    <>
      <style>{styleInline}</style>
      {/* MCP mode indicator */}
      <div
        style={{
          position: "absolute",
          top: 18,
          zIndex: 10,
          background: applicationStatusStore.mcpEnabled ? "linear-gradient(90deg,#00A7A0 60%,#00C2B2 100%)" : "none",
          color: applicationStatusStore.mcpEnabled ? "#fff" : "#888",
          borderRadius: 16,
          padding: "8px 20px",
          fontWeight: 700,
          fontSize: 16,
          boxShadow: applicationStatusStore.mcpEnabled
            ? "0 2px 12px rgba(0,167,160,0.18)"
            : "0 2px 12px rgba(180,180,180,0.10)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          letterSpacing: 1,
          border: applicationStatusStore.mcpEnabled ? "2px solid #00A7A0" : "2px solid rgb(87 87 87)",
          animation: applicationStatusStore.mcpEnabled ? "mcpPulse 1.2s infinite alternate" : "none",
        }}
      >
        <span style={{ fontSize: 22, marginRight: 8, opacity: applicationStatusStore.mcpEnabled ? 1 : 0.5 }}>🧠</span>
        MCP Mode {applicationStatusStore.mcpEnabled ? "Enabled" : "Disabled"}
      </div>
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
