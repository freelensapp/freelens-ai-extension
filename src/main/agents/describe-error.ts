// Turns an error of a run or of Explain into the message the chat shows. Pure,
// so it is unit-tested without the host.

const isTransientOverload = (message: string) =>
  message.includes("failed to parse stream") ||
  message.includes("503") ||
  message.includes("unavailable") ||
  message.includes("high demand") ||
  message.includes("429") ||
  message.includes("too many requests");

// The AI SDK gives up on a request it retried with a `RetryError`, whose
// `lastError` is the failure of the last attempt.
const lastAttemptError = (error: Error): Error => {
  const lastError = (error as Error & { lastError?: unknown }).lastError;
  return error.name === "AI_RetryError" && lastError instanceof Error ? lastError : error;
};

export const describeAgentError = (cause: unknown, baseUrl: string): string => {
  if (!(cause instanceof Error)) {
    return String(cause);
  }
  const error = lastAttemptError(cause);

  const message = error.message.toLowerCase();
  // Duck-type the status of an HTTP error: the AI SDK's APICallError carries a
  // numeric `statusCode`, the OpenAI SDK's errors a `status`. A request that
  // never reached the endpoint has none, while a server error has >= 500.
  const { status, statusCode } = error as Error & { status?: unknown; statusCode?: unknown };
  const errorStatus = statusCode ?? status;

  // True connection failure: main never reached the endpoint (wrong base URL,
  // network blocked, the HTTPS proxy of the preferences refusing it).
  const isConnectionFailure =
    error.constructor?.name === "APIConnectionError" ||
    (errorStatus === undefined &&
      (message.includes("failed to fetch") ||
        message.includes("fetch failed") ||
        message.includes("network error") ||
        message.includes("cannot connect to api")));

  if (isConnectionFailure) {
    return `Could not reach the AI endpoint ${baseUrl}. Check the base URL, your network connection, and that the endpoint is reachable. Original error: ${error.message}`;
  }

  if (typeof errorStatus === "number" && errorStatus >= 500) {
    return `The AI endpoint ${baseUrl} answered with a server error. Check that the endpoint is running and the base URL is correct. Original error: ${error.message}`;
  }

  if (isTransientOverload(message)) {
    return "Gemini is temporarily overloaded (high demand). Please retry in a few seconds.";
  }

  return error.message;
};
