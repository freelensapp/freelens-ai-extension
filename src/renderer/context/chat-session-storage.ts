// Transient run state of the chat. It lives in `sessionStorage`, so a fresh app
// start never resurrects a spinner for a run that is no longer active. The chat
// itself is rebuilt from main's pi session.
export const IS_LOADING_KEY = "isLoading";
