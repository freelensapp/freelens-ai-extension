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
            <button
              className="chat-button chat-clear-button"
              onClick={async () => applicationStatusStore.clearChat()}
              disabled={applicationStatusStore.chatMessages?.length === 0}
              title="Clear chat"
            >
              <Eraser size={20} />
            </button>
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
              {/* Button to toggle tools view */}
              <button
                className="text-input-list-toggle-button"
                onClick={() => setShowList((prev) => !prev)}
                title={showList ? "Hide Tools" : "Show Tools"}
                style={{ marginLeft: 8 }}
              >
                {showList ? "Hide Tools" : "Show Tools"}
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
