// Turns what the host's JSON client rejects with into the text the model sees.

interface KubeStatusLike {
  kind?: unknown;
  code?: unknown;
  reason?: unknown;
  message?: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * The client rejects with an `Error` when the request fails or is aborted,
 * with the API server's `Status` (or its text) when a GET is answered 403, and
 * with its own parsed API error for every other failed answer, whose string
 * form is the server's message.
 */
export function describeRequestError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (!isObject(error)) return String(error);

  const status = error as KubeStatusLike;
  if (typeof status.message === "string" && status.message.length > 0) return status.message;
  if (status.kind === "Status") return `${String(status.reason ?? "Failure")} (${String(status.code)})`;

  const text = String(error);
  if (text.length > 0 && text !== "[object Object]") return text;
  try {
    return JSON.stringify(error);
  } catch {
    return text;
  }
}
