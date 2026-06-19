import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";

const AI_PROXY_HOST = "127.0.0.1";

// Header set by the renderer (see model-provider.ts) carrying the full upstream
// base URL (including any path, e.g. https://api.openai.com/v1). When present it
// overrides the static prefix map below, so the user can configure a custom
// base URL without changing the proxy.
const UPSTREAM_BASE_URL_HEADER = "x-upstream-base-url";

const UPSTREAM_BY_PREFIX: Record<string, string> = {
  openai: "https://api.openai.com/v1",
};

let proxyServerStarted = false;
let proxyServerPort: number | null = null;
// Resolves the upstream API key inside the main process so the secret never has
// to be sent from (or stored in) the renderer. Evaluated per request so a key
// changed in preferences takes effect immediately.
let resolveApiKey: () => string | undefined = () => undefined;

// Only the methods and headers the LLM SDKs actually use. The wildcard origin
// is replaced by reflecting the caller's Origin (see applyCorsHeaders) so the
// proxy never advertises itself as open to every origin.
const CORS_ALLOW_METHODS = "GET,POST,OPTIONS";
const CORS_ALLOW_HEADERS =
  "authorization,content-type,x-stainless-os,x-stainless-runtime-version,x-stainless-package-version,x-stainless-runtime,x-stainless-arch,x-stainless-retry-count,x-stainless-lang,accept,user-agent,x-upstream-base-url";

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Normalize the possibly-array Origin header to a single value.
const getRequestOrigin = (request: IncomingMessage): string | undefined => {
  const origin = request.headers.origin;
  return Array.isArray(origin) ? origin[0] : origin;
};

export const applyCorsHeaders = (response: ServerResponse, requestOrigin: string | undefined) => {
  // Reflect the caller's origin instead of "*". The renderer (the only intended
  // caller) always sends an Origin header; requests without one are not
  // browser-originated and need no CORS grant.
  if (requestOrigin) {
    response.setHeader("access-control-allow-origin", requestOrigin);
    response.setHeader("vary", "Origin");
  }

  response.setHeader("access-control-allow-methods", CORS_ALLOW_METHODS);
  response.setHeader("access-control-allow-headers", CORS_ALLOW_HEADERS);
};

const readRequestBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

// Override the Authorization header with the API key resolved in the main
// process. The renderer sends only a placeholder, so the real key never travels
// through (or is exposed to) the renderer / DevTools. No-op when no key is set,
// letting the upstream reject the request with its own 401.
export const applyManagedAuthorization = (headers: Headers, apiKey: string | undefined): Headers => {
  if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  return headers;
};

const createUpstreamHeaders = (request: IncomingMessage) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (hopByHopHeaders.has(key) || key === UPSTREAM_BASE_URL_HEADER || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else {
      headers.set(key, value);
    }
  }

  return applyManagedAuthorization(headers, resolveApiKey());
};

const proxyRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const requestPath = request.url ?? "/";

  // Extract provider prefix: /<prefix>/rest/of/path
  const match = requestPath.match(/^\/([^/]+)(\/.*)?$/);
  const prefix = match?.[1] ?? "";

  // Prefer the upstream base URL advertised by the renderer; fall back to the
  // static prefix map for callers that do not set the header.
  const headerBaseUrl = request.headers[UPSTREAM_BASE_URL_HEADER];
  const upstreamBaseUrl = (typeof headerBaseUrl === "string" && headerBaseUrl) || UPSTREAM_BY_PREFIX[prefix];

  if (!upstreamBaseUrl) {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: `Unknown proxy prefix: ${prefix}` }));
    return;
  }

  const remainingPath = match?.[2] ?? "/";
  // Preserve any path on the base URL (e.g. ".../v1") instead of letting the
  // absolute remaining path replace it.
  const upstreamBase = new URL(upstreamBaseUrl);
  const basePath = upstreamBase.pathname.replace(/\/$/, "");
  const upstreamUrl = new URL(`${basePath}${remainingPath}`, upstreamBase.origin);
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request);

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers: createUpstreamHeaders(request),
    body,
  });

  response.statusCode = upstreamResponse.status;
  response.statusMessage = upstreamResponse.statusText;
  applyCorsHeaders(response, getRequestOrigin(request));

  upstreamResponse.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key)) {
      response.setHeader(key, value);
    }
  });

  if (!upstreamResponse.body) {
    response.end();
    return;
  }

  Readable.fromWeb(upstreamResponse.body as any).pipe(response);
};

export const startAiProxyServer = async (apiKeyResolver: () => string | undefined = () => undefined) => {
  resolveApiKey = apiKeyResolver;

  if (proxyServerStarted && proxyServerPort !== null) {
    return proxyServerPort;
  }

  const server = createServer(async (request, response) => {
    applyCorsHeaders(response, getRequestOrigin(request));

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    try {
      await proxyRequest(request, response);
    } catch (error) {
      response.statusCode = 502;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, AI_PROXY_HOST, () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve the AI proxy server port."));
        return;
      }

      proxyServerPort = (address as AddressInfo).port;
      proxyServerStarted = true;
      server.off("error", reject);
      resolve();
    });
  });

  return proxyServerPort;
};
