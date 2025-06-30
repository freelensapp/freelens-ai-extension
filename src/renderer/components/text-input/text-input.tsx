import { Renderer } from "@freelensapp/extensions";
import { Eraser, SendHorizonal } from "lucide-react";
import { observer } from "mobx-react";
import { PreferencesStore } from "../../../common/store";
import styleInline from "./text-input.scss?inline";
import { useTextInput } from "./text-input-hook";

import type { AIModelsEnum } from "../../business/provider/ai-models";

const {
  Component: { Select },
} = Renderer;

type TextInputOption = Renderer.Component.SelectOption<AIModelsEnum>;

type TextInputProps = {
  onSend: (message: string) => void;
};

export const TextInput = observer(({ onSend }: TextInputProps) => {
  const preferencesStore = PreferencesStore.getInstance<PreferencesStore>();
  const textInputHook = useTextInput({ onSend, preferencesStore });
  const textInputOptions = textInputHook.modelSelections as TextInputOption[];

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
              onClick={async () => preferencesStore.clearChat()}
              disabled={preferencesStore.chatMessages.length === 0}
              title="Clear chat"
            >
              <Eraser size={20} />
            </button>
            <div style={{ display: "flex", alignItems: "center" }}>
              <Select
                id="update-channel-input"
                options={textInputOptions}
                value={preferencesStore.selectedModel}
                onChange={textInputHook.onChangeModel}
                themeName="lens"
                className="text-input-select-box"
              />
              <button
                className="text-input-send-button"
                onClick={textInputHook.handleSend}
                disabled={preferencesStore.isLoading || !textInputHook.message.trim()}
                title="Send"
                id="send-button"
              >
                <SendHorizonal size={25} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
});
