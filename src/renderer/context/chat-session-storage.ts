import type { MessageObject } from "../business/objects/message-object";

// Storage keys backing the chat session. The chat transcript and its
// conversation id are the durable "session": they live in `localStorage` so
// they survive an application restart and are wiped only by the "clear session"
// button. The loading / interrupted flags are transient run-state and live in
// `sessionStorage`, so a fresh app start never resurrects a spinner or a
// half-finished approval prompt for a run that is no longer active.
export const CHAT_MESSAGES_KEY = "chatMessages";
export const CONVERSATION_ID_KEY = "conversationId";
export const IS_LOADING_KEY = "isLoading";
export const IS_CONVERSATION_INTERRUPTED_KEY = "isConversationInterrupted";

// Minimal subset of the DOM `Storage` API used here; accepting it as a
// parameter keeps these helpers free of `window` so they can be unit-tested.
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Read the persisted chat transcript. Returns an empty array when nothing is
 * stored or when the stored value is corrupt, so a bad entry can never crash
 * the provider during initialization.
 */
export const loadChatMessages = (storage: KeyValueStorage): MessageObject[] => {
  const raw = storage.getItem(CHAT_MESSAGES_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MessageObject[]) : [];
  } catch {
    return [];
  }
};

/** Persist the chat transcript. */
export const saveChatMessages = (storage: KeyValueStorage, messages: MessageObject[]): void => {
  storage.setItem(CHAT_MESSAGES_KEY, JSON.stringify(messages));
};

/** Read the persisted conversation id, or `null` when none is stored. */
export const loadConversationId = (storage: KeyValueStorage): string | null => {
  return storage.getItem(CONVERSATION_ID_KEY);
};

/** Persist the conversation id. */
export const saveConversationId = (storage: KeyValueStorage, conversationId: string): void => {
  storage.setItem(CONVERSATION_ID_KEY, conversationId);
};
