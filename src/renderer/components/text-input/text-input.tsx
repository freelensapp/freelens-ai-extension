import { Renderer } from "@freelensapp/extensions";
import { MessageSquarePlus, SendHorizonal, Square, Trash2 } from "lucide-react";
import * as MobxReact from "mobx-react";
import * as React from "react";
import { formatCost } from "../../business/provider/model-pricing";
import { formatTokenUsage } from "../../business/service/token-usage";
import { useApplicationStatusStore } from "../../context/application-context";
import { AvailableTools } from "../available-tools/available-tools";
import styleInline from "./text-input.scss?inline";
import { useTextInput } from "./text-input-hook";
import { TokenCapacityIndicator } from "./token-capacity-indicator";

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
            placeholder={applicationStatusStore.isLoading ? "The agent is working..." : "Write a message..."}
            disabled={applicationStatusStore.isLoading}
            value={textInputHook.message}
            onChange={(e) => textInputHook.setMessage(e.target.value)}
            onKeyDown={textInputHook.handleKeyDown}
          />
          <div className="text-input-buttons-container">
            <div id="chatButtonsContainer" style={{ display: "flex" }}>
              {/* New chat: stops a run, the old chat stays saved until retention deletes it */}
              <button
                className="chat-button chat-clear-button"
                onClick={() => applicationStatusStore.clearChat()}
                disabled={applicationStatusStore.chatMessages?.length === 0}
                title="New chat"
              >
                <MessageSquarePlus size={20} />
              </button>
              <button
                className="chat-button chat-clear-button"
                onClick={() => {
                  if (window.confirm("Delete all saved chats of this cluster? This cannot be undone.")) {
                    void applicationStatusStore.deleteAllChats();
                  }
                }}
                title="Delete all chats of this cluster"
              >
                <Trash2 size={20} />
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
              {applicationStatusStore.compactionStatus && (
                <span
                  className={`text-input-compaction-status${
                    applicationStatusStore.compactionStatus === "compacting" ? " compacting" : ""
                  }`}
                  title="The conversation was getting close to the model's input token limit, so it was summarized to free up context."
                >
                  {applicationStatusStore.compactionStatus === "compacting"
                    ? "Compacting conversation..."
                    : "Compacted conversation."}
                </span>
              )}
              {textInputHook.agentConfigured && (
                <span
                  className="text-input-token-counter text-input-tooltip"
                  data-tooltip="Tokens used this session (input, cached input, output), with estimated cost when known. Resets when the chat is cleared."
                >
                  {formatTokenUsage(applicationStatusStore.tokenUsage)}
                  {applicationStatusStore.sessionCost > 0 ? ` = ${formatCost(applicationStatusStore.sessionCost)}` : ""}
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
              {textInputHook.agentConfigured && (
                <TokenCapacityIndicator
                  usedTokens={applicationStatusStore.lastInputTokens}
                  maxTokens={applicationStatusStore.getMaxInputTokens()}
                  peakTokens={applicationStatusStore.lastPeakInputTokens}
                />
              )}
              {/* While a run is going, Stop is the only action */}
              {applicationStatusStore.isAgentRunning ? (
                <button
                  className="text-input-send-button text-input-stop-button"
                  onClick={() => applicationStatusStore.stopAgent()}
                  title="Stop"
                  id="stop-button"
                >
                  <Square size={20} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="text-input-send-button"
                  onClick={textInputHook.handleSend}
                  disabled={applicationStatusStore.isLoading || !textInputHook.message.trim()}
                  title="Send"
                  id="send-button"
                >
                  <SendHorizonal size={25} />
                </button>
              )}
            </div>
          </div>
          {/* List of tools */}
          {showList && <AvailableTools />}
        </div>
      </div>
    </>
  );
});
