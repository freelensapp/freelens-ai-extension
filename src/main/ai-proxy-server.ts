import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";

const AI_PROXY_HOST = "127.0.0.1";

const UPSTREAM_BY_PREFIX: Record<string, string> = {
  openai: "https://api.openai.com",
  google: "https://generativelanguage.googleapis.com",
};

let proxyServerStarted = false;
let proxyServerPort: number | null = null;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers":
    "authorization,content-type,x-stainless-os,x-stainless-runtime-version,x-stainless-package-version,x-stainless-runtime,x-stainless-arch,x-stainless-retry-count,x-stainless-lang,accept,user-agent,x-goog-api-key,x-goog-api-client",
} as const;

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

const applyCorsHeaders = (response: ServerResponse) => {
  for (const [header, value] of Object.entries(corsHeaders)) {
    response.setHeader(header, value);
  }
};

const readRequestBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

const createUpstreamHeaders = (request: IncomingMessage) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (hopByHopHeaders.has(key) || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else {
      headers.set(key, value);
    }
  }

  return headers;
};

const proxyRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const requestPath = request.url ?? "/";

  // Extract provider prefix: /<prefix>/rest/of/path
  const match = requestPath.match(/^\/([^/]+)(\/.*)?$/);
  const prefix = match?.[1] ?? "";
  const upstreamOrigin = UPSTREAM_BY_PREFIX[prefix];

  if (!upstreamOrigin) {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: `Unknown proxy prefix: ${prefix}` }));
    return;
  }

  const remainingPath = match?.[2] ?? "/";
  const upstreamUrl = new URL(remainingPath, upstreamOrigin);
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request);

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers: createUpstreamHeaders(request),
    body,
  });

  response.statusCode = upstreamResponse.status;
  response.statusMessage = upstreamResponse.statusText;
  applyCorsHeaders(response);

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

export const startAiProxyServer = async () => {
  if (proxyServerStarted && proxyServerPort !== null) {
    return proxyServerPort;
  }

  const server = createServer(async (request, response) => {
    applyCorsHeaders(response);

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
