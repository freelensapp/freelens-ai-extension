import { describe, expect, it } from "vitest";
import { describeAgentError } from "./describe-error";

const BASE_URL = "http://litellm.local:4000";

describe("describeAgentError", () => {
  it("names the endpoint when main could not reach it", () => {
    expect(describeAgentError(new TypeError("fetch failed"), BASE_URL)).toBe(
      `Could not reach the AI endpoint ${BASE_URL}. Check the base URL, your network connection, and that the endpoint is reachable. Original error: fetch failed`,
    );

    class APIConnectionError extends Error {}
    expect(describeAgentError(new APIConnectionError("Connection error."), BASE_URL)).toContain(
      `Could not reach the AI endpoint ${BASE_URL}.`,
    );
  });

  it("names the endpoint on a server error", () => {
    const error = Object.assign(new Error("502 Bad Gateway"), { status: 502 });

    expect(describeAgentError(error, BASE_URL)).toContain(`The AI endpoint ${BASE_URL} answered with a server error.`);
  });

  it("explains a transient overload", () => {
    const error = Object.assign(new Error("429 Too Many Requests"), { status: 429 });

    expect(describeAgentError(error, BASE_URL)).toBe(
      "Gemini is temporarily overloaded (high demand). Please retry in a few seconds.",
    );
  });

  it("keeps any other message as it is", () => {
    expect(describeAgentError(new Error("No model selected."), BASE_URL)).toBe("No model selected.");
    expect(describeAgentError("plain", BASE_URL)).toBe("plain");
  });
});
