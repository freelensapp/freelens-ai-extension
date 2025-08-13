import { Renderer } from "@freelensapp/extensions";
import { Eraser, SendHorizonal } from "lucide-react";
import * as React from "react";
import { AIModelsEnum } from "../../business/provider/ai-models";
import { useApplicationStatusStore } from "../../context/application-context";
import { AvailableTools } from "../available-tools/available-tools";
import styleInline from "./text-input.scss?inline";
import { useTextInput } from "./text-input-hook";

const {
  Component: { Select },
} = Renderer;

type TextInputOption = Renderer.Component.SelectOption<AIModelsEnum>;

type TextInputProps = {
  onSend: (message: string) => void;
};

export const TextInput = ({ onSend }: TextInputProps) => {
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
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <Select
                id="update-channel-input"
                options={textInputOptions}
                value={applicationStatusStore.selectedModel}
                onChange={textInputHook.onChangeModel}
                themeName="lens"
                className="text-input-select-box"
              />
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
};
