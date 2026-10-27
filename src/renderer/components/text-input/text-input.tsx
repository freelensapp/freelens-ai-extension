import { Renderer } from "@freelensapp/extensions";
import { MessageSquarePlus, SendHorizonal, Square, Trash2, Wrench } from "lucide-react";
import * as MobxReact from "mobx-react";
import * as React from "react";
import { useApplicationStatusStore } from "../../context/application-context";
import { AvailableTools } from "../available-tools/available-tools";
import styles from "./text-input.module.scss";
import { useTextInput } from "./text-input-hook";
import { TokenCapacityIndicator } from "./token-capacity-indicator";
import { formatCost, formatTokenCounts, tokenCounts } from "./usage-format";

const { observer } = MobxReact;

const {
  Component: { Button, Select },
} = Renderer;

type TextInputProps = {
  onSend: (message: string) => void;
};

export const TextInput = observer(({ onSend }: TextInputProps) => {
  const applicationStatusStore = useApplicationStatusStore();
  const textInputHook = useTextInput({ onSend });
  // Everything below comes from pi's stats for the chat, computed in main: the
  // cost from each answer's model price, the context from the session's model.
  const stats = applicationStatusStore.sessionStats;
  const sessionCost = stats?.cost ?? 0;
  const contextUsage = stats?.contextUsage;

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
            placeholder={applicationStatusStore.isLoading ? "The agent is working..." : "Write a message..."}
            disabled={applicationStatusStore.isLoading}
            value={textInputHook.message}
            onChange={(e) => textInputHook.setMessage(e.target.value)}
            onKeyDown={textInputHook.handleKeyDown}
          />
          <div className={styles.textInputButtonsContainer}>
            <div id="chatButtonsContainer" style={{ display: "flex" }}>
              {/* New chat: stops a run, the old chat stays saved until retention deletes it */}
              <button
                className={`chat-button ${styles.chatClearButton}`}
                onClick={() => applicationStatusStore.clearChat()}
                disabled={applicationStatusStore.chatMessages?.length === 0}
                title="New chat"
              >
                <MessageSquarePlus size={20} />
              </button>
              <button
                className={`chat-button ${styles.chatClearButton}`}
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
                <Wrench size={18} />
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center" }}>
              {textInputHook.agentConfigured && (
                <span
                  className={`${styles.textInputTokenCounter} ${styles.textInputTooltip}`}
                  data-tooltip="Tokens used in this chat (input, cached input, output), with the cost when the model's price is known. Starts again with a new chat."
                >
                  {formatTokenCounts(tokenCounts(stats?.tokens))}
                  {sessionCost > 0 ? ` = ${formatCost(sessionCost)}` : ""}
                </span>
              )}
              {textInputHook.agentConfigured && (
                <Select
                  id="chat-model-picker"
                  options={textInputHook.modelSelections}
                  value={textInputHook.pickedModel ?? null}
                  placeholder="Choose a model"
                  onChange={textInputHook.onChangeModel}
                  themeName="lens"
                  className={styles.textInputSelectBox}
                />
              )}
              {textInputHook.noProviderConnected && (
                <>
                  <span className={styles.textInputNoProvider}>No AI provider is connected.</span>
                  <Button
                    primary
                    label="Connect a provider"
                    onClick={textInputHook.goToPreferences}
                    title="Add an API key or sign in to a provider in the Freelens AI settings."
                  />
                </>
              )}
              {textInputHook.agentConfigured && (
                <TokenCapacityIndicator
                  usedTokens={contextUsage ? contextUsage.tokens : 0}
                  maxTokens={contextUsage?.contextWindow || textInputHook.pickedModelSummary?.contextWindow || 0}
                />
              )}
              {/* While a run is going, Stop is the only action */}
              {applicationStatusStore.isAgentRunning ? (
                <button
                  className={styles.textInputSendButton}
                  onClick={() => applicationStatusStore.stopAgent()}
                  title="Stop"
                  id="stop-button"
                >
                  <Square size={20} fill="currentColor" />
                </button>
              ) : (
                <button
                  className={styles.textInputSendButton}
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
