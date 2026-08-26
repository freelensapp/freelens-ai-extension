import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("replaces the API key of an agent input", () => {
    const agentInput = {
      modelName: "gpt-5.5",
      modelApiKey: "sk-super-secret",
      messages: [{ role: "user", content: "hello" }],
    };

    expect(redactSecrets(agentInput)).toEqual({
      modelName: "gpt-5.5",
      modelApiKey: REDACTED,
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("does not mutate the input", () => {
    const agentInput = { modelApiKey: "sk-super-secret" };
    redactSecrets(agentInput);
    expect(agentInput.modelApiKey).toBe("sk-super-secret");
  });

  it("replaces the key nested in a graph state snapshot", () => {
    const snapshot = { values: { modelApiKey: "sk-super-secret" }, next: ["conclusionsAgent"] };
    expect(redactSecrets(snapshot)).toEqual({ values: { modelApiKey: REDACTED }, next: ["conclusionsAgent"] });
  });

  it("replaces keys inside arrays", () => {
    expect(redactSecrets([{ apiKey: "one" }, { api_key: "two" }])).toEqual([
      { apiKey: REDACTED },
      { api_key: REDACTED },
    ]);
  });

  it("returns the original reference when there is nothing to redact", () => {
    const state = { modelName: "gpt-5.5", messages: [] };
    expect(redactSecrets(state)).toBe(state);
  });

  it("leaves an unset key visible for troubleshooting", () => {
    expect(redactSecrets({ modelApiKey: "" })).toEqual({ modelApiKey: "" });
    expect(redactSecrets({ modelApiKey: undefined })).toEqual({ modelApiKey: undefined });
  });

  it("leaves class instances untouched", () => {
    class Message {
      constructor(readonly content: string) {}
    }
    const error = new Error("boom");
    const message = new Message("hi");

    expect(redactSecrets(error)).toBe(error);
    expect(redactSecrets({ modelApiKey: "sk-x", message }).message).toBe(message);
  });

  it("passes through primitives and nullish values", () => {
    expect(redactSecrets("plain")).toBe("plain");
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  it("stops at the depth limit instead of walking a cyclic object forever", () => {
    const cyclic: Record<string, unknown> = { modelApiKey: "sk-super-secret" };
    cyclic.self = cyclic;

    const redacted = redactSecrets(cyclic) as Record<string, unknown>;

    expect(redacted.modelApiKey).toBe(REDACTED);
  });
});
