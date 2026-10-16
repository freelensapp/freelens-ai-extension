import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { finished } from "node:stream";
import { BRIDGE_HOST, BRIDGE_TOKEN_HEADER, type BridgeRoutePath } from "../../common/bridge/protocol";
import { encodeSseEvent } from "../../common/bridge/sse";
import type { AddressInfo } from "node:net";

// The renderer is the only intended caller. Its frames are served from
// https://renderer.freelens.app:<port> and https://<clusterId>.renderer.freelens.app:<port>;
// the caller's Origin is reflected (see applyCorsHeaders) rather than "*", so
// the bridge never advertises itself as open to every origin.
const CORS_ALLOW_METHODS = "GET,POST,OPTIONS";
const CORS_ALLOW_HEADERS = `content-type,${BRIDGE_TOKEN_HEADER}`;

export interface BridgeInput {
  // The parsed JSON body of a POST, undefined for a GET.
  body: unknown;
  query: URLSearchParams;
  // Aborted when the caller closes the request or the bridge closes.
  signal: AbortSignal;
}

export type BridgeRouteHandler =
  // Answers with one JSON body.
  | { method: "GET" | "POST"; kind: "json"; handle: (input: BridgeInput) => Promise<unknown> }
  // Answers with an SSE stream of the events the iterable yields, then a
  // `done` event, an `error` event when it throws, or a `cancelled` event when
  // the bridge closes first.
  | { method: "GET" | "POST"; kind: "stream"; handle: (input: BridgeInput) => AsyncIterable<object> };

export type BridgeRoutes = Partial<Record<BridgeRoutePath, BridgeRouteHandler>>;

export interface BridgeServer {
  port: number;
  // Ends every open stream with a `cancelled` event, cancels every open
  // request and stops listening.
  close(): Promise<void>;
}

// How long close() waits for the open answers to reach their callers before it
// cuts the connections that are still open.
const CLOSE_TIMEOUT_MS = 1000;

interface OpenRequest {
  controller: AbortController;
  response: ServerResponse;
  stream: boolean;
}

// Normalize the possibly-array Origin header to a single value.
const getRequestOrigin = (request: IncomingMessage): string | undefined => {
  const origin = request.headers.origin;
  return Array.isArray(origin) ? origin[0] : origin;
};

export const applyCorsHeaders = (response: ServerResponse, requestOrigin: string | undefined) => {
  // Requests without an Origin are not browser-originated and need no CORS
  // grant.
  if (requestOrigin) {
    response.setHeader("access-control-allow-origin", requestOrigin);
    response.setHeader("vary", "Origin");
  }

  response.setHeader("access-control-allow-methods", CORS_ALLOW_METHODS);
  response.setHeader("access-control-allow-headers", CORS_ALLOW_HEADERS);
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const sendJson = (response: ServerResponse, statusCode: number, body: unknown) => {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const startStream = (response: ServerResponse) => {
  response.statusCode = 200;
  response.setHeader("content-type", "text/event-stream");
  response.setHeader("cache-control", "no-cache");
  response.flushHeaders();
};

// Ends a stream with a `cancelled` event when the bridge closes, so that the
// caller reads a complete body rather than a connection cut in the middle of
// it, which Chromium reports as a network error.
const cancelStream = (response: ServerResponse) => {
  if (response.writableEnded) {
    return;
  }
  if (!response.headersSent) {
    startStream(response);
  }
  response.end(encodeSseEvent({ type: "cancelled" }));
};

// Resolves when the answer has been handed to the operating system, or the
// connection is gone.
const responseFinished = (response: ServerResponse) =>
  new Promise<void>((resolve) => {
    finished(response, () => resolve());
  });

const streamEvents = async (response: ServerResponse, events: AsyncIterable<object>, signal: AbortSignal) => {
  startStream(response);

  try {
    for await (const event of events) {
      if (signal.aborted) {
        break;
      }
      response.write(encodeSseEvent(event));
    }
    if (!signal.aborted) {
      response.write(encodeSseEvent({ type: "done" }));
    }
  } catch (error) {
    if (!signal.aborted) {
      response.write(encodeSseEvent({ type: "error", error: { message: errorMessage(error) } }));
    }
  }
  response.end();
};

/**
 * Starts the bridge on an ephemeral port of 127.0.0.1. Every request but a CORS
 * preflight must carry `token` in BRIDGE_TOKEN_HEADER.
 */
export const startBridgeServer = async ({
  token,
  routes,
  closeTimeoutMs = CLOSE_TIMEOUT_MS,
}: {
  token: string;
  routes: BridgeRoutes;
  closeTimeoutMs?: number;
}): Promise<BridgeServer> => {
  const openRequests = new Set<OpenRequest>();

  const server = createServer(async (request, response) => {
    applyCorsHeaders(response, getRequestOrigin(request));

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (request.headers[BRIDGE_TOKEN_HEADER] !== token) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${BRIDGE_HOST}`);
    const route = routes[url.pathname as BridgeRoutePath];
    if (!route) {
      sendJson(response, 404, { error: `Unknown route: ${url.pathname}` });
      return;
    }
    if (request.method !== route.method) {
      sendJson(response, 405, { error: `Method not allowed: ${request.method}` });
      return;
    }

    const openRequest: OpenRequest = { controller: new AbortController(), response, stream: route.kind === "stream" };
    const { controller } = openRequest;
    openRequests.add(openRequest);
    // The caller closing the request before the answer ends cancels the work
    // behind it, a run of the agents above all.
    response.once("close", () => {
      openRequests.delete(openRequest);
      if (!response.writableFinished) {
        controller.abort();
      }
    });

    try {
      const body = request.method === "POST" ? await readJsonBody(request) : undefined;
      const input: BridgeInput = { body, query: url.searchParams, signal: controller.signal };

      if (route.kind === "stream") {
        // Cancelled while its body was read: the answer is already ended, and
        // the run is not started.
        if (!controller.signal.aborted) {
          await streamEvents(response, route.handle(input), controller.signal);
        }
      } else {
        sendJson(response, 200, await route.handle(input));
      }
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: errorMessage(error) });
      } else {
        response.end();
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, BRIDGE_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to resolve the bridge port.");
  }

  return {
    port: (address as AddressInfo).port,
    close: async () => {
      const open = [...openRequests];
      // The streams end first, with a last event, so that a run cut by the
      // extension stopping reaches the renderer as a complete answer. The
      // abort then stops the work behind every request.
      for (const { response, stream } of open) {
        if (stream) {
          cancelStream(response);
        }
      }
      for (const { controller } of open) {
        controller.abort();
      }

      // Stops listening and closes the idle connections; it calls back once
      // every connection is closed.
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));

      // A JSON answer gets as long as the bound to finish after the abort.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(open.map(({ response }) => responseFinished(response))),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, closeTimeoutMs);
        }),
      ]);
      clearTimeout(timer);

      server.closeAllConnections();
      await closed;
    },
  };
};
