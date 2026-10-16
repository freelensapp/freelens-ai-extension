import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { BRIDGE_TOKEN_HEADER, BridgeRoute } from "../../common/bridge/protocol";
import { applyCorsHeaders, type BridgeRoutes, type BridgeServer, startBridgeServer } from "./server";
import type { IncomingHttpHeaders, ServerResponse } from "node:http";

// Minimal ServerResponse stand-in that records setHeader calls.
const createResponseStub = () => {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as unknown as ServerResponse & { headers: Record<string, string> };
};

describe("applyCorsHeaders", () => {
  it("reflects the caller's origin instead of a wildcard", () => {
    const response = createResponseStub();
    applyCorsHeaders(response, "https://c56ec0d3.renderer.freelens.app:52341");
    expect(response.headers["access-control-allow-origin"]).toBe("https://c56ec0d3.renderer.freelens.app:52341");
    expect(response.headers.vary).toBe("Origin");
  });

  it("omits the allow-origin header for non-browser callers", () => {
    const response = createResponseStub();
    applyCorsHeaders(response, undefined);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers.vary).toBeUndefined();
  });

  it("allows the token header the renderer sends", () => {
    const response = createResponseStub();
    applyCorsHeaders(response, "https://renderer.freelens.app:52341");
    expect(response.headers["access-control-allow-headers"]).toContain(BRIDGE_TOKEN_HEADER);
    expect(response.headers["access-control-allow-methods"]).toBe("GET,POST,OPTIONS");
  });
});

const TOKEN = "test-bridge-token";

interface BridgeResponse {
  statusCode: number | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

// A real HTTP call, so the assertions cover what the server puts on the wire.
const callBridge = (
  port: number,
  path: string,
  {
    method = "POST",
    body,
    headers = { [BRIDGE_TOKEN_HEADER]: TOKEN },
  }: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) =>
  new Promise<BridgeResponse>((resolve, reject) => {
    const clientRequest = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (incoming) => {
      let text = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk) => {
        text += chunk;
      });
      incoming.on("end", () => resolve({ statusCode: incoming.statusCode, headers: incoming.headers, body: text }));
      // A body cut before its end, which Chromium reports as a network error.
      incoming.on("close", () => {
        if (!incoming.complete) {
          reject(new Error("The answer was cut before its end."));
        }
      });
    });
    clientRequest.on("error", reject);
    clientRequest.end(body === undefined ? undefined : JSON.stringify(body));
  });

const sseEvents = (body: string) =>
  body
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice("data: ".length)));

describe("startBridgeServer", () => {
  let bridge: BridgeServer | undefined;

  const start = async (routes: BridgeRoutes) => {
    bridge = await startBridgeServer({ token: TOKEN, routes });
    return bridge.port;
  };

  afterEach(async () => {
    await bridge?.close();
    bridge = undefined;
  });

  it("refuses a request without the token", async () => {
    const port = await start({
      [BridgeRoute.compact]: { method: "POST", kind: "json", handle: async () => ({ summary: null }) },
    });

    const withoutToken = await callBridge(port, BridgeRoute.compact, { body: {}, headers: {} });
    const withWrongToken = await callBridge(port, BridgeRoute.compact, {
      body: {},
      headers: { [BRIDGE_TOKEN_HEADER]: "guess" },
    });

    expect(withoutToken.statusCode).toBe(401);
    expect(withWrongToken.statusCode).toBe(401);
  });

  it("answers a CORS preflight without the token", async () => {
    const port = await start({});

    const response = await callBridge(port, BridgeRoute.run, {
      method: "OPTIONS",
      headers: { origin: "https://renderer.freelens.app:52341" },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://renderer.freelens.app:52341");
  });

  it("hands the JSON body to the route and answers with its result", async () => {
    const port = await start({
      [BridgeRoute.compact]: {
        method: "POST",
        kind: "json",
        handle: async ({ body }) => ({ received: body }),
      },
    });

    const response = await callBridge(port, BridgeRoute.compact, { body: { clusterId: "c1" } });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ received: { clusterId: "c1" } });
  });

  it("answers an unknown route with 404 and a wrong method with 405", async () => {
    const port = await start({
      [BridgeRoute.tools]: { method: "GET", kind: "json", handle: async () => ({ tools: [] }) },
    });

    expect((await callBridge(port, "/unknown", { body: {} })).statusCode).toBe(404);
    expect((await callBridge(port, BridgeRoute.tools, { body: {} })).statusCode).toBe(405);
  });

  it("streams the events of a route as SSE and ends with done", async () => {
    const port = await start({
      [BridgeRoute.run]: {
        method: "POST",
        kind: "stream",
        handle: async function* () {
          yield { type: "text", text: "Hello" };
          yield { type: "text", text: " world" };
        },
      },
    });

    const response = await callBridge(port, BridgeRoute.run, { body: {} });

    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(sseEvents(response.body)).toEqual([
      { type: "text", text: "Hello" },
      { type: "text", text: " world" },
      { type: "done" },
    ]);
  });

  it("ends a stream with an error event when the route throws", async () => {
    const port = await start({
      [BridgeRoute.run]: {
        method: "POST",
        kind: "stream",
        handle: async function* () {
          yield { type: "text", text: "partial" };
          throw new Error("model unavailable");
        },
      },
    });

    const response = await callBridge(port, BridgeRoute.run, { body: {} });

    expect(sseEvents(response.body)).toEqual([
      { type: "text", text: "partial" },
      { type: "error", error: { message: "model unavailable" } },
    ]);
  });

  it("aborts the route when the caller closes the stream", async () => {
    let aborted: () => void = () => undefined;
    const abortedPromise = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const port = await start({
      [BridgeRoute.run]: {
        method: "POST",
        kind: "stream",
        handle: async function* ({ signal }) {
          signal.addEventListener("abort", () => aborted());
          yield { type: "text", text: "first" };
          await new Promise(() => undefined);
        },
      },
    });

    const clientRequest = httpRequest(
      { host: "127.0.0.1", port, path: BridgeRoute.run, method: "POST", headers: { [BRIDGE_TOKEN_HEADER]: TOKEN } },
      (incoming) => {
        // Close the request as soon as the first event arrives.
        incoming.once("data", () => clientRequest.destroy());
      },
    );
    clientRequest.on("error", () => undefined);
    clientRequest.end("{}");

    await expect(abortedPromise).resolves.toBeUndefined();
  });

  it("aborts open requests when the bridge closes", async () => {
    let signal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => {
      void start({
        [BridgeRoute.run]: {
          method: "POST",
          kind: "stream",
          handle: async function* (input) {
            signal = input.signal;
            resolve();
            yield { type: "text", text: "first" };
            await new Promise(() => undefined);
          },
        },
      }).then((port) => {
        const clientRequest = httpRequest({
          host: "127.0.0.1",
          port,
          path: BridgeRoute.run,
          method: "POST",
          headers: { [BRIDGE_TOKEN_HEADER]: TOKEN },
        });
        clientRequest.on("error", () => undefined);
        clientRequest.end("{}");
      });
    });

    await started;
    await bridge?.close();
    bridge = undefined;

    expect(signal?.aborted).toBe(true);
  });

  it("ends an open stream with a cancelled event when the bridge closes", async () => {
    let streaming: () => void = () => undefined;
    const streamingPromise = new Promise<void>((resolve) => {
      streaming = resolve;
    });
    const port = await start({
      [BridgeRoute.run]: {
        method: "POST",
        kind: "stream",
        handle: async function* () {
          yield { type: "text", text: "first" };
          // Asked for the next event once the first is written; a run waiting
          // for the model does not see the abort at once.
          streaming();
          await new Promise(() => undefined);
        },
      },
    });

    const response = callBridge(port, BridgeRoute.run, { body: {} });
    await streamingPromise;
    await bridge?.close();
    bridge = undefined;

    expect(sseEvents((await response).body)).toEqual([{ type: "text", text: "first" }, { type: "cancelled" }]);
  });

  it("cuts the connections that do not finish in time when the bridge closes", async () => {
    let started: () => void = () => undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    bridge = await startBridgeServer({
      token: TOKEN,
      closeTimeoutMs: 50,
      routes: {
        [BridgeRoute.compact]: {
          method: "POST",
          kind: "json",
          handle: () => {
            started();
            return new Promise(() => undefined);
          },
        },
      },
    });

    const response = callBridge(bridge.port, BridgeRoute.compact, { body: {} });
    await startedPromise;
    await bridge.close();
    bridge = undefined;

    await expect(response).rejects.toThrow();
  });
});
