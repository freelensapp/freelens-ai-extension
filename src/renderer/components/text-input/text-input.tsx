import { Renderer } from "@freelensapp/extensions";
import { Eraser, SendHorizonal, ShieldOff } from "lucide-react";
import * as MobxReact from "mobx-react";
import * as React from "react";
import { formatTokenUsage } from "../../business/service/token-usage";
import { useApplicationStatusStore } from "../../context/application-context";
import { AvailableTools } from "../available-tools/available-tools";
import styleInline from "./text-input.scss?inline";
import { useTextInput } from "./text-input-hook";

const { observer } = MobxReact;

const {
  Component: { Button, Select },
} = Renderer;

type TextInputOption = Renderer.Component.SelectOption<string>;

type TextInputProps = {
  onSend: (message: string) => void;
};

export const TextInput = observer(({ onSend }: TextInputProps) => {
  const applicationStatusStore = useApplicationStatusStore();
  const textInputHook = useTextInput({ onSend });
  const textInputOptions = textInputHook.modelSelections as TextInputOption[];

  // State for showing/hiding the vertical list
  const [showList, setShowList] = React.useState(false);

  return (
    <>
      <style>{styleInline}</style>
      <div className="text-input-container">
        <div className="text-input-inner-wrapper">
          <textarea
            ref={textInputHook.textareaRef}
            rows={1}
            className="text-input-textarea"
            placeholder="Write a message..."
            value={textInputHook.message}
            onChange={(e) => textInputHook.setMessage(e.target.value)}
            onKeyDown={textInputHook.handleKeyDown}
          />
          <div className="text-input-buttons-container">
            <div id="chatButtonsContainer" style={{ display: "flex" }}>
              {/* Button to clear the chat history */}
              <button
                className="chat-button chat-clear-button"
                onClick={async () => applicationStatusStore.clearChat()}
                disabled={applicationStatusStore.chatMessages?.length === 0}
                title="Clear chat"
              >
                <Eraser size={20} />
              </button>
              {/* Button to toggle tools */}
              <button
                className={`chat-button chat-clear-button${showList ? " active" : ""}`}
                onClick={() => setShowList((prev) => !prev)}
                title={showList ? "Hide Tools" : "Show Tools"}
                style={{
                  borderRadius: "15px",
                  width: 38,
                  height: 38,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                  boxShadow: showList ? "0 2px 8px rgba(0,167,160,0.15)" : "none",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#00A7A0";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(0,167,160,0.15)";
                }}
              >
                <span style={{ marginRight: 0 }}>🛠️</span>
              </button>
              {/* Button to toggle Bypass Approvals mode */}
              <button
                className={`chat-button chat-clear-button${applicationStatusStore.bypassApprovals ? " active" : ""}`}
                onClick={() => applicationStatusStore.setBypassApprovals(!applicationStatusStore.bypassApprovals)}
                title={
                  applicationStatusStore.bypassApprovals
                    ? "Disable Bypass Approvals Mode (tool calls will require confirmation)"
                    : "Enable Bypass Approvals Mode (tool calls will be auto-approved)"
                }
                id="bypass-approvals-button"
                style={{
                  borderRadius: "15px",
                  width: 38,
                  height: 38,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                  background: applicationStatusStore.bypassApprovals ? "#E0A800" : undefined,
                  color: applicationStatusStore.bypassApprovals ? "#fff" : undefined,
                  borderColor: applicationStatusStore.bypassApprovals ? "#E0A800" : undefined,
                  boxShadow: applicationStatusStore.bypassApprovals ? "0 2px 8px rgba(224,168,0,0.25)" : "none",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                <ShieldOff size={18} />
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              {textInputHook.agentConfigured && (
                <span
                  className="text-input-token-counter"
                  title="Tokens used this session (input, cached input, output). Resets when the chat is cleared."
                >
                  {formatTokenUsage(applicationStatusStore.tokenUsage)}
                </span>
              )}
              {textInputHook.agentConfigured ? (
                <Select
                  id="update-channel-input"
                  options={textInputOptions}
                  value={applicationStatusStore.selectedModel}
                  onChange={textInputHook.onChangeModel}
                  themeName="lens"
                  className="text-input-select-box"
                />
              ) : (
                <Button
                  primary
                  label="Configure agent"
                  onClick={textInputHook.goToPreferences}
                  title="Set an API key and add a model in Freelens AI settings."
                />
              )}
              <button
                className="text-input-send-button"
                onClick={textInputHook.handleSend}
                disabled={applicationStatusStore.isLoading || !textInputHook.message.trim()}
                title="Send"
                id="send-button"
              >
                <SendHorizonal size={25} />
              </button>
            </div>
          </div>
          {/* List of tools */}
          {showList && <AvailableTools />}
        </div>
      </div>
    </>
  );
});
