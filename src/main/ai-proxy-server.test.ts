import { describe, expect, it } from "vitest";
import { applyCorsHeaders } from "./ai-proxy-server";
import type { ServerResponse } from "node:http";

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
