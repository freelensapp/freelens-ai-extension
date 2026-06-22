// Transient run-state for the chat session. These flags live in
// `sessionStorage`, so a fresh app start never resurrects a spinner or a
// half-finished approval prompt for a run that is no longer active.
//
// The durable part of the session (the chat transcript and its conversation id)
// is persisted in the host-managed `ChatSessionStore` instead: `localStorage`
// is not durable across application restarts in the Freelens renderer, so the
// transcript would disappear while the model-side LangGraph state came back.
export const IS_LOADING_KEY = "isLoading";
export const IS_CONVERSATION_INTERRUPTED_KEY = "isConversationInterrupted";
