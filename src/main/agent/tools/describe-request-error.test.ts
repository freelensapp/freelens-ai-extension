import { describe, expect, it } from "vitest";
import { ParsedApiErrorStandIn } from "../../../../test/kube-json-api";
import { describeRequestError } from "./describe-request-error";

describe("describeRequestError", () => {
  it("gives the message of an Error, such as a failed or aborted fetch", () => {
    expect(describeRequestError(new TypeError("fetch failed"))).toBe("fetch failed");
    expect(describeRequestError(new DOMException("This operation was aborted", "AbortError"))).toBe(
      "This operation was aborted",
    );
  });

  it("gives the message of the Kubernetes Status a GET answered 403 rejects with", () => {
    const status = {
      kind: "Status",
      apiVersion: "v1",
      metadata: {},
      status: "Failure",
      message: 'pods is forbidden: User "dev" cannot list resource "pods" in API group "" in the namespace "prod"',
      reason: "Forbidden",
      code: 403,
    };

    expect(describeRequestError(status)).toBe(
      'pods is forbidden: User "dev" cannot list resource "pods" in API group "" in the namespace "prod"',
    );
  });

  it("names the reason and code of a Status without a message", () => {
    expect(describeRequestError({ kind: "Status", apiVersion: "v1", code: 503, reason: "ServiceUnavailable" })).toBe(
      "ServiceUnavailable (503)",
    );
  });

  it("gives the string form of the host's parsed API error", () => {
    const error = new ParsedApiErrorStandIn({ code: 404, reason: "NotFound", message: 'pods "gone" not found' }, [
      'pods "gone" not found',
    ]);

    expect(describeRequestError(error)).toBe('pods "gone" not found');
  });

  it("gives the text a GET answered 403 rejects with when the body is not JSON", () => {
    expect(describeRequestError("Forbidden")).toBe("Forbidden");
  });

  it("falls back to the JSON of any other object instead of '[object Object]'", () => {
    expect(describeRequestError({ reason: "Forbidden", code: 403 })).toBe('{"reason":"Forbidden","code":403}');
  });
});
