// The renderer's side of the bridge to the agents in main (see
// src/common/bridge/protocol.ts). Requests go through `Renderer.Util.fetch`;
// the port and the token are read from PreferencesStore for every request, so
// after a reload of the extension the next request reaches the new bridge.

import { Renderer } from "@freelensapp/extensions";
import { BRIDGE_HOST, BRIDGE_TOKEN_HEADER, type BridgeRoutePath } from "../../../common/bridge/protocol";
import { readSseEvents } from "../../../common/bridge/sse";
import { PreferencesStore } from "../../../common/store";

interface BridgeRequest {
  method: "GET" | "POST";
  path: BridgeRoutePath;
  query?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The message of an error answer, which the bridge sends as `{ error }`.
const readErrorAnswer = async (response: { status: number; text(): Promise<string> }) => {
  const text = await response.text().catch(() => "");
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // Not JSON: fall back to the status below.
  }
  return text || `HTTP ${response.status}`;
};

const request = async ({ method, path, query, body, signal }: BridgeRequest) => {
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  const port = preferencesStore.aiProxyPort;
  const token = preferencesStore.aiProxyToken;
  if (port === null || !token) {
    throw new Error("The extension's main process is not ready yet. Retry in a moment.");
  }

  const url = new URL(`http://${BRIDGE_HOST}:${port}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = { [BRIDGE_TOKEN_HEADER]: token };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }

  let response: Awaited<ReturnType<typeof Renderer.Util.fetch>>;
  try {
    response = await Renderer.Util.fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw new Error(`Could not reach the extension's main process on port ${port}: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    throw new Error(await readErrorAnswer(response));
  }
  return response;
};

export const getFromBridge = async <T>(path: BridgeRoutePath, query?: Record<string, string>): Promise<T> =>
  (await (await request({ method: "GET", path, query })).json()) as T;

export const postToBridge = async <T>(path: BridgeRoutePath, body: unknown): Promise<T> =>
  (await (await request({ method: "POST", path, body })).json()) as T;

/**
 * Starts a streamed request and yields its events as they arrive. Stopping the
 * iteration, or aborting `signal`, closes the request, which cancels the work
 * behind it in main.
 */
export async function* streamFromBridge<T>(
  path: BridgeRoutePath,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<T, void, unknown> {
  const response = await request({ method: "POST", path, body, signal });
  if (!response.body) {
    throw new Error("The bridge answered without a body.");
  }
  yield* readSseEvents<T>(response.body);
}
