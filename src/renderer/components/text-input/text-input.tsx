import { Renderer } from "@freelensapp/extensions";
import { Eraser, SendHorizonal, ShieldOff } from "lucide-react";
import * as MobxReact from "mobx-react";
import * as React from "react";
import { formatCost } from "../../../common/provider/model-pricing";
import { formatTokenUsage } from "../../../common/service/token-usage";
import { useApplicationStatusStore } from "../../context/application-context";
import { AvailableTools } from "../available-tools/available-tools";
import styles from "./text-input.module.scss";
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
      <div className={styles.textInputContainer}>
        <div className={styles.textInputInnerWrapper}>
          <textarea
            ref={textInputHook.textareaRef}
            rows={1}
            className={styles.textInputTextarea}
            placeholder="Write a message..."
            value={textInputHook.message}
            onChange={(e) => textInputHook.setMessage(e.target.value)}
            onKeyDown={textInputHook.handleKeyDown}
          />
          <div className={styles.textInputButtonsContainer}>
            <div id="chatButtonsContainer" style={{ display: "flex" }}>
              {/* Button to clear the chat history */}
              <button
                className={`chat-button ${styles.chatClearButton}`}
                onClick={async () => applicationStatusStore.clearChat()}
                disabled={applicationStatusStore.chatMessages?.length === 0}
                title="Clear chat"
              >
                <Eraser size={20} />
              </button>
              {/* Button to toggle tools */}
              <button
                className={`chat-button ${styles.chatClearButton}${showList ? " active" : ""}`}
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
                className={`chat-button ${styles.chatClearButton}${applicationStatusStore.bypassApprovals ? " active" : ""}`}
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
              {applicationStatusStore.compactionStatus && (
                <span
                  className={`${styles.textInputCompactionStatus}${
                    applicationStatusStore.compactionStatus === "compacting" ? ` ${styles.compacting}` : ""
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
                  className={`${styles.textInputTokenCounter} ${styles.textInputTooltip}`}
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
                  className={styles.textInputSelectBox}
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
              <button
                className={styles.textInputSendButton}
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
