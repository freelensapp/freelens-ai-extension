// Turns an error of a run or of Explain into the message the chat shows. Pure,
// so it is unit-tested without the host.

const isTransientOverload = (message: string) =>
  message.includes("failed to parse stream") ||
  message.includes("503") ||
  message.includes("unavailable") ||
  message.includes("high demand") ||
  message.includes("429") ||
  message.includes("too many requests");

export const describeAgentError = (error: unknown, baseUrl: string): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const message = error.message.toLowerCase();
  // Duck-type the OpenAI SDK error shape: APIError subclasses carry a numeric
  // `status`. APIConnectionError has status === undefined (the request never
  // reached the endpoint at all), while InternalServerError has status >= 500.
  const errorStatus = (error as Error & { status?: unknown }).status;

  // True connection failure: main never reached the endpoint (wrong base URL,
  // network blocked, the HTTPS proxy of the preferences refusing it).
  const isConnectionFailure =
    error.constructor?.name === "APIConnectionError" ||
    (errorStatus === undefined &&
      (message.includes("failed to fetch") || message.includes("fetch failed") || message.includes("network error")));

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
