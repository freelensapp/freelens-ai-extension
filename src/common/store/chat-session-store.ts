import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { emptyTokenUsage, type TokenUsage } from "../../renderer/business/service/token-usage";

import type { MessageObject } from "../../renderer/business/objects/message-object";

export interface ChatSession {
  // The rendered chat transcript and the conversation id that ties it to the
  // agent's LangGraph thread. Both make up the durable "session".
  messages: MessageObject[];
  conversationId: string;
  // Running token totals for this session, summed across every model turn.
  // Reset when the session is cleared.
  tokenUsage: TokenUsage;
  // Input tokens of the previous response's largest model turn - the naive proxy
  // for the current context size, used to decide when to compact before the next
  // prompt. Reset when the session is cleared or compacted.
  lastInputTokens: number;
}

export interface ChatSessionModel {
  // One chat session per cluster, keyed by the cluster id. The store is backed
  // by a single host-managed JSON file shared across every cluster frame, so the
  // transcript and conversation thread are kept apart by this key rather than
  // every cluster sharing one session.
  sessions: Record<string, ChatSession>;
}

const emptySession = (): ChatSession => ({
  messages: [],
  conversationId: "",
  tokenUsage: emptyTokenUsage(),
  lastInputTokens: 0,
});

/**
 * Durable, host-managed persistence for the rendered chat sessions (the
 * transcript shown in the UI and its conversation id), one per cluster. This is
 * the Freelens-native place to store extension state: the host writes it to a
 * JSON file in the extension's data directory, so it survives an application
 * restart.
 *
 * The transcript previously lived in `window.localStorage`, which is not
 * durable across restarts in the Freelens renderer: the model-side LangGraph
 * state (persisted via `AgentStateStore`, an `ExtensionStore`) came back after a
 * restart while the chat HTML did not. Backing the transcript with the same
 * host-managed mechanism keeps the two in sync.
 *
 * Sessions are keyed by cluster id so switching clusters shows that cluster's
 * own chat rather than a single shared one.
 */
export class ChatSessionStore extends Common.Store.ExtensionStore<ChatSessionModel> {
  sessions: Record<string, ChatSession> = {};

  constructor() {
    super({
      configName: "freelens-ai-chat-session-store",
      defaults: {
        sessions: {},
      },
    });
    // Explicit annotation form instead of `@observable` decorators; see the
    // note in preferences-store.ts for why decorators do not work here.
    makeObservable(this, {
      sessions: observable,
    });
  }

  private session(clusterId: string): ChatSession {
    return this.sessions[clusterId] ?? emptySession();
  }

  // Replace the map so MobX sees a new reference and the host persists it.
  private patch(clusterId: string, partial: Partial<ChatSession>): void {
    this.sessions = { ...this.sessions, [clusterId]: { ...this.session(clusterId), ...partial } };
  }

  getMessages(clusterId: string): MessageObject[] {
    return this.session(clusterId).messages;
  }

  setMessages(clusterId: string, messages: MessageObject[]): void {
    this.patch(clusterId, { messages });
  }

  getConversationId(clusterId: string): string {
    return this.session(clusterId).conversationId;
  }

  setConversationId(clusterId: string, conversationId: string): void {
    this.patch(clusterId, { conversationId });
  }

  getTokenUsage(clusterId: string): TokenUsage {
    return this.session(clusterId).tokenUsage ?? emptyTokenUsage();
  }

  setTokenUsage(clusterId: string, tokenUsage: TokenUsage): void {
    this.patch(clusterId, { tokenUsage });
  }

  getLastInputTokens(clusterId: string): number {
    return this.session(clusterId).lastInputTokens ?? 0;
  }

  setLastInputTokens(clusterId: string, lastInputTokens: number): void {
    this.patch(clusterId, { lastInputTokens });
  }

  clear(clusterId: string): void {
    // Clearing the session also zeroes the token counter and the context-size
    // estimate that drives compaction.
    this.patch(clusterId, { messages: [], tokenUsage: emptyTokenUsage(), lastInputTokens: 0 });
  }

  fromStore(model: ChatSessionModel): void {
    this.sessions = model.sessions ?? {};
  }

  toJSON(): ChatSessionModel {
    // `messages` is an observable array; the host persists this value by sending
    // it over IPC, which structure-clones it. A live MobX proxy cannot be
    // cloned ("An object could not be cloned"), so convert it to a plain array
    // with `toJS` before returning. See preferences-store.ts for the same note.
    const sessions: Record<string, ChatSession> = {};
    for (const [clusterId, session] of Object.entries(this.sessions)) {
      sessions[clusterId] = {
        messages: toJS(session.messages),
        conversationId: session.conversationId,
        tokenUsage: toJS(session.tokenUsage) ?? emptyTokenUsage(),
        lastInputTokens: session.lastInputTokens ?? 0,
      };
    }
    return { sessions };
  }
}
