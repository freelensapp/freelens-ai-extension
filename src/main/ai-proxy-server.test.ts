import { request as httpRequest } from "node:http";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyCorsHeaders,
  applyManagedAuthorization,
  isForwardableRequestHeader,
  isForwardableResponseHeader,
  startAiProxyServer,
} from "./ai-proxy-server";
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
    applyCorsHeaders(response, "lens://extension");
    expect(response.headers["access-control-allow-origin"]).toBe("lens://extension");
    expect(response.headers.vary).toBe("Origin");
  });

  it("omits the allow-origin header for non-browser callers", () => {
    const response = createResponseStub();
    applyCorsHeaders(response, undefined);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers.vary).toBeUndefined();
  });

  it("advertises only the methods the SDKs use", () => {
    const response = createResponseStub();
    applyCorsHeaders(response, "lens://extension");
    expect(response.headers["access-control-allow-methods"]).toBe("GET,POST,OPTIONS");
  });
});

describe("applyManagedAuthorization", () => {
  it("sets the Authorization header from the resolved key", () => {
    const headers = new Headers();
    applyManagedAuthorization(headers, "sk-secret");
    expect(headers.get("authorization")).toBe("Bearer sk-secret");
  });

  it("overrides any Authorization sent by the renderer placeholder", () => {
    const headers = new Headers({ authorization: "Bearer freelens-proxy-managed" });
    applyManagedAuthorization(headers, "sk-real");
    expect(headers.get("authorization")).toBe("Bearer sk-real");
  });

  it("leaves the headers untouched when no key is resolved", () => {
    const headers = new Headers({ authorization: "Bearer placeholder" });
    applyManagedAuthorization(headers, undefined);
    expect(headers.get("authorization")).toBe("Bearer placeholder");
  });
});

describe("isForwardableResponseHeader", () => {
  it("drops content-encoding, which no longer describes the decoded body", () => {
    expect(isForwardableResponseHeader("content-encoding")).toBe(false);
    expect(isForwardableResponseHeader("Content-Encoding")).toBe(false);
  });

  it("drops hop-by-hop headers", () => {
    for (const header of ["connection", "content-length", "keep-alive", "transfer-encoding", "upgrade"]) {
      expect(isForwardableResponseHeader(header)).toBe(false);
    }
  });

  it("forwards ordinary response headers", () => {
    for (const header of ["content-type", "cache-control", "etag", "x-request-id"]) {
      expect(isForwardableResponseHeader(header)).toBe(true);
    }
  });
});

describe("isForwardableRequestHeader", () => {
  const authenticated = { applyAuth: true };

  it("drops the browser context the renderer attaches to every request", () => {
    // Ollama rejects the renderer's Origin (http://<cluster-id>.localhost:<port>)
    // with a bodyless 403 when it is forwarded.
    for (const header of [
      "origin",
      "Origin",
      "referer",
      "cookie",
      "sec-fetch-mode",
      "sec-fetch-site",
      "sec-fetch-dest",
      "sec-ch-ua",
      "sec-ch-ua-platform",
    ]) {
      expect(isForwardableRequestHeader(header, authenticated)).toBe(false);
    }
  });

  it("drops hop-by-hop headers and the proxy's own headers", () => {
    for (const header of [
      "connection",
      "content-length",
      "host",
      "transfer-encoding",
      "x-upstream-base-url",
      "x-ai-proxy-token",
      "x-ai-proxy-no-auth",
    ]) {
      expect(isForwardableRequestHeader(header, authenticated)).toBe(false);
    }
  });

  it("forwards the headers the LLM SDKs rely on", () => {
    for (const header of ["content-type", "accept", "user-agent", "x-stainless-lang", "x-stainless-package-version"]) {
      expect(isForwardableRequestHeader(header, authenticated)).toBe(true);
    }
  });

  it("keeps Authorization only on authenticated routes", () => {
    expect(isForwardableRequestHeader("authorization", authenticated)).toBe(true);
    // No-auth route (the public LiteLLM price list): neither the managed key nor
    // the renderer's placeholder may travel to a third party.
    expect(isForwardableRequestHeader("authorization", { applyAuth: false })).toBe(false);
    expect(isForwardableRequestHeader("Authorization", { applyAuth: false })).toBe(false);
    expect(isForwardableRequestHeader("content-type", { applyAuth: false })).toBe(true);
  });
});

const PROXY_TOKEN = "test-proxy-token";

interface ProxiedResponse {
  statusCode: number | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

// Real HTTP call against the proxy, so the assertions cover the headers the
// server actually puts on the wire.
const requestThroughProxy = (port: number, path: string, extraHeaders: Record<string, string> = {}) =>
  new Promise<ProxiedResponse>((resolve, reject) => {
    const clientRequest = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: {
          "x-ai-proxy-token": PROXY_TOKEN,
          "x-ai-proxy-no-auth": "1",
          ...extraHeaders,
        },
      },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => {
          body += chunk;
        });
        incoming.on("end", () => {
          resolve({ statusCode: incoming.statusCode, headers: incoming.headers, body });
        });
      },
    );

    clientRequest.on("error", reject);
    clientRequest.end();
  });

describe("proxied response headers", () => {
  const upstreamBody = JSON.stringify({ "gpt-5.5": { input_cost_per_token: 0.00000125 } });
  let proxyPort: number;

  beforeAll(async () => {
    const port = await startAiProxyServer(PROXY_TOKEN);

    if (port === null) {
      throw new Error("The AI proxy server did not report a port.");
    }

    proxyPort = port;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves the decoded body without the upstream content-encoding", async () => {
    // What undici hands back: the body is already decompressed, but the
    // content-encoding of the wire format is still on the headers.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(upstreamBody, {
            status: 200,
            headers: {
              "content-encoding": "gzip",
              "content-type": "application/json",
            },
          }),
      ),
    );

    const response = await requestThroughProxy(proxyPort, "/litellm/model_prices.json");

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(upstreamBody);
    // Dropped: the renderer would otherwise fail with ERR_CONTENT_DECODING_FAILED.
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["content-type"]).toBe("application/json");
  });

  it("strips the renderer's browser context from the upstream request", async () => {
    // Ollama answers a forwarded Freelens renderer Origin with a bodyless 403.
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        new Response(upstreamBody, { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestThroughProxy(proxyPort, "/litellm/model_prices.json", {
      origin: "http://c56ec0d3ac1f4e0a9d2b.localhost:52341",
      referer: "http://c56ec0d3ac1f4e0a9d2b.localhost:52341/",
      cookie: "session=secret",
      "sec-fetch-mode": "cors",
      "sec-ch-ua-platform": '"macOS"',
      "content-type": "application/json",
    });

    const upstreamHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(upstreamHeaders.get("origin")).toBeNull();
    expect(upstreamHeaders.get("referer")).toBeNull();
    expect(upstreamHeaders.get("cookie")).toBeNull();
    expect(upstreamHeaders.get("sec-fetch-mode")).toBeNull();
    expect(upstreamHeaders.get("sec-ch-ua-platform")).toBeNull();
    expect(upstreamHeaders.get("content-type")).toBe("application/json");
  });
});
