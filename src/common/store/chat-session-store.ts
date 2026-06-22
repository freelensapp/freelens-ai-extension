import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";

import type { MessageObject } from "../../renderer/business/objects/message-object";

export interface ChatSessionModel {
  // The rendered chat transcript and the conversation id that ties it to the
  // agent's LangGraph thread. Both make up the durable "session".
  messages: MessageObject[];
  conversationId: string;
}

/**
 * Durable, host-managed persistence for the rendered chat session (the
 * transcript shown in the UI and its conversation id). This is the
 * Freelens-native place to store extension state: the host writes it to a JSON
 * file in the extension's data directory, so it survives an application restart.
 *
 * The transcript previously lived in `window.localStorage`, which is not
 * durable across restarts in the Freelens renderer: the model-side LangGraph
 * state (persisted via `AgentStateStore`, an `ExtensionStore`) came back after a
 * restart while the chat HTML did not. Backing the transcript with the same
 * host-managed mechanism keeps the two in sync.
 */
export class ChatSessionStore extends Common.Store.ExtensionStore<ChatSessionModel> {
  messages: MessageObject[] = [];
  conversationId: string = "";

  constructor() {
    super({
      configName: "freelens-ai-chat-session-store",
      defaults: {
        messages: [],
        conversationId: "",
      },
    });
    // Explicit annotation form instead of `@observable` decorators; see the
    // note in preferences-store.ts for why decorators do not work here.
    makeObservable(this, {
      messages: observable,
      conversationId: observable,
    });
  }

  setMessages(messages: MessageObject[]): void {
    this.messages = messages;
  }

  setConversationId(conversationId: string): void {
    this.conversationId = conversationId;
  }

  clear(): void {
    this.messages = [];
  }

  fromStore(model: ChatSessionModel): void {
    this.messages = model.messages ?? [];
    this.conversationId = model.conversationId ?? "";
  }

  toJSON(): ChatSessionModel {
    // `messages` is an observable array; the host persists this value by sending
    // it over IPC, which structure-clones it. A live MobX proxy cannot be
    // cloned ("An object could not be cloned"), so convert it to a plain array
    // with `toJS` before returning. See preferences-store.ts for the same note.
    return {
      messages: toJS(this.messages),
      conversationId: this.conversationId,
    };
  }
}
