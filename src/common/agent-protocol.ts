// The IPC protocol between the pi agent host in main and the cluster frames.
// Main broadcasts envelopes to every frame; each frame keeps only its own
// cluster's. Frames send commands to main and get a response back through the
// `invoke` promise. Shapes follow pi's RPC mode (`RpcCommand`, `RpcResponse`,
// `JsonAgentSessionEvent`) so events from pi reach the renderer unchanged.
//
// pi's types are declared here rather than imported: every entry point of
// pi's packages reaches Node's types through the provider SDKs it exports,
// and this file is compiled into the renderer and common programs, which must
// not see Node. The declarations cover the fields the frames and the agent
// host's tests read. Main sends pi's objects unchanged, and the agent host's
// type check holds them to these declarations: a role or an event type pi adds
// fails it until it is listed here.

/** pi's `TextContent`. */
export interface TextContent {
  type: "text";
  text: string;
}

/** pi's `ThinkingContent`. */
export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

/** pi's `ImageContent`; the chat does not show images. */
export interface ImageContent {
  type: "image";
}

/** pi's `ToolCall` content; the chat shows tool calls from their events instead. */
export interface ToolCallContent {
  type: "toolCall";
}

/** pi's `UserMessage`. */
export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

/** pi's `StopReason`. */
export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

/** pi's `AssistantMessage`. */
export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCallContent)[];
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

/** The other roles of pi's `AgentMessage`; the chat does not show them. */
export interface OtherAgentMessage {
  role: "system" | "toolResult" | "bashExecution" | "custom" | "branchSummary" | "compactionSummary";
}

/** pi's `AgentMessage`. */
export type AgentMessage = UserMessage | AssistantMessage | OtherAgentMessage;

/** pi's `AssistantMessageEvent` without the partial message, as pi's RPC mode sends it. */
export type AssistantMessageEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | {
      type:
        | "start"
        | "text_start"
        | "text_end"
        | "thinking_start"
        | "thinking_end"
        | "toolcall_start"
        | "toolcall_delta"
        | "toolcall_end"
        | "done"
        | "error";
    };

/** pi's `JsonAgentSessionEvent`: a session event as pi's RPC mode sends it. */
export type JsonAgentSessionEvent =
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | {
      type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
      toolCallId: string;
      toolName: string;
    }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  /** `result` is pi's `CompactionResult`, undefined when the compaction failed. */
  | { type: "compaction_end"; result: unknown; aborted: boolean; errorMessage?: string }
  | {
      type:
        | "agent_start"
        | "agent_end"
        | "agent_settled"
        | "turn_start"
        | "turn_end"
        | "queue_update"
        | "compaction_start"
        | "entry_appended"
        | "session_info_changed"
        | "thinking_level_changed"
        | "auto_retry_end"
        | "summarization_retry_scheduled"
        | "summarization_retry_attempt_start"
        | "summarization_retry_finished"
        | "bash_execution_update";
    };

/** pi's `ContextUsage`. */
export interface ContextUsage {
  /** Estimated context tokens, or null if unknown (right after a compaction, before the next answer). */
  tokens: number | null;
  contextWindow: number;
  /** Context usage as a percentage of the context window, or null if `tokens` is unknown. */
  percent: number | null;
}

/** pi's `SessionStats`. */
export interface SessionStats {
  sessionFile: string | undefined;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: ContextUsage;
}

export const AGENT_COMMAND_CHANNEL = "agent:command";
export const AGENT_ENVELOPE_CHANNEL = "agent:envelope";

/** Chats not changed for this many days are deleted unless the user sets otherwise; 0 keeps them forever. */
export const DEFAULT_CHAT_RETENTION_DAYS = 30;

/** What an approval is about; main loads the backup of the object it names. */
export interface ApprovalTarget {
  tool: string;
  kind?: string;
  apiVersion?: string;
  name?: string;
  namespace?: string;
}

/**
 * Main asks the user to approve a tool call: pi's `confirm` UI request, with
 * the action as YAML in `message` and the object it is about.
 */
export interface ApprovalRequest {
  id: string;
  toolCallId: string;
  method: "confirm";
  title: string;
  message: string;
  approval: ApprovalTarget;
  /**
   * The current YAML of the object the call would change, loaded before
   * asking; absent for a create, a read, or when the object could not be loaded.
   */
  backup?: string;
}

/** An approval was answered, or denied by Stop. */
export interface ApprovalResolution {
  id: string;
  confirmed: boolean;
}

interface EnvelopeBase {
  clusterId: string;
  sessionId: string;
  /** Increases by one for every envelope of a cluster. */
  seq: number;
}

export type AgentEnvelope =
  | (EnvelopeBase & { kind: "event"; payload: JsonAgentSessionEvent })
  | (EnvelopeBase & { kind: "ui_request"; payload: ApprovalRequest })
  | (EnvelopeBase & { kind: "ui_resolved"; payload: ApprovalResolution })
  /** "Approve all in this chat" was turned on or off. */
  | (EnvelopeBase & { kind: "auto_approve"; payload: { enabled: boolean } })
  /**
   * pi's totals for the chat: tokens, cost and how full the context is. Sent
   * after each saved assistant message and when a run settles.
   */
  | (EnvelopeBase & { kind: "stats"; payload: SessionStats });

/** A message of the chat transcript as main sends it in a snapshot. */
export type ChatMessage = UserMessage | AssistantMessage;

/** Where pi compacted the chat: the messages before it were summarized for the model. */
export interface CompactionMarker {
  role: "compaction";
  timestamp: number;
}

export type TranscriptEntry = ChatMessage | CompactionMarker;

/**
 * Everything a frame needs to show a cluster's chat when it opens or remounts,
 * even mid-run. The frame then applies only envelopes with a higher `seq`.
 */
export interface AgentSnapshot {
  sessionId?: string;
  /**
   * The saved user and assistant messages of the active session, also those
   * pi has since compacted away from the model's context, with a marker where
   * each compaction happened.
   */
  messages: TranscriptEntry[];
  /** The assistant answer being streamed right now, if any. */
  streamingMessage?: AssistantMessage;
  isStreaming: boolean;
  /** The approval main is waiting on; the card comes back on remount. */
  pendingUiRequest?: ApprovalRequest;
  /** "Approve all in this chat" is on: gated calls run without asking. */
  autoApprove: boolean;
  /** The chat's totals; undefined for a cluster that never chatted. */
  stats?: SessionStats;
  /** The last envelope main sent for this cluster. */
  seq: number;
}

export type AgentCommand =
  | { type: "prompt"; message: string }
  /**
   * AI Explain: a one-shot answer with no tools. It streams as `event`
   * envelopes under its own `sessionId` and is not saved into the chat.
   */
  | { type: "explain"; message: string }
  | { type: "abort" }
  | { type: "get_snapshot" }
  /** Answers with the chat's `SessionStats`, or no data for a cluster that never chatted. */
  | { type: "get_session_stats" }
  /** Stops a run, then starts a new chat; answers with the new chat's snapshot. */
  | { type: "new_session" }
  /** Stops a run, deletes every chat of the cluster and starts a new one; answers with its snapshot. */
  | { type: "delete_sessions" }
  /** `approveAll` with `confirmed` also stops asking for the rest of the chat. */
  | { type: "ui_response"; id: string; confirmed: boolean; approveAll?: boolean }
  /** Turns "Approve all in this chat" off; only an approval answer turns it on. */
  | { type: "set_auto_approve"; enabled: false };

export type AgentResponse =
  | { type: "response"; command: string; success: true; data?: unknown }
  | { type: "response"; command: string; success: false; error: string };
