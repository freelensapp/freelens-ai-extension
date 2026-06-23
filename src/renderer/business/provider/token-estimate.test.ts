import { describe, expect, it } from "vitest";
import { approximateMessagesTokenCount, approximateTokenCount, messageContentToText } from "./token-estimate";

describe("messageContentToText", () => {
  it("returns a plain string unchanged", () => {
    expect(messageContentToText("hello world")).toBe("hello world");
  });

  it("concatenates the text parts of an array of content blocks", () => {
    const content = [
      { type: "text" as const, text: "foo" },
      { type: "text" as const, text: "bar" },
    ];
    expect(messageContentToText(content)).toBe("foobar");
  });

  it("ignores non-text content blocks", () => {
    const content = [
      { type: "text" as const, text: "caption" },
      { type: "image_url" as const, image_url: { url: "https://example.com/a.png" } },
    ];
    expect(messageContentToText(content)).toBe("caption");
  });

  it("returns an empty string for an empty array", () => {
    expect(messageContentToText([])).toBe("");
  });
});

describe("approximateTokenCount", () => {
  it("counts roughly four characters per token, rounding up", () => {
    expect(approximateTokenCount("12345678")).toBe(2);
    expect(approximateTokenCount("123456789")).toBe(3);
  });

  it("returns zero for empty content", () => {
    expect(approximateTokenCount("")).toBe(0);
  });

  it("counts the combined text of content blocks", () => {
    const content = [
      { type: "text" as const, text: "aaaa" },
      { type: "text" as const, text: "bbbb" },
    ];
    expect(approximateTokenCount(content)).toBe(2);
  });
});

describe("approximateMessagesTokenCount", () => {
  it("sums the per-message estimate", () => {
    const messages = [{ content: "12345678" }, { content: "123456789" }];
    expect(approximateMessagesTokenCount(messages)).toBe(5);
  });

  it("returns zero for an empty list", () => {
    expect(approximateMessagesTokenCount([])).toBe(0);
  });

  it("returns zero when the messages are undefined", () => {
    expect(approximateMessagesTokenCount(undefined)).toBe(0);
  });

  it("counts content-block messages alongside plain-string messages", () => {
    const messages = [{ content: "aaaa" }, { content: [{ type: "text" as const, text: "bbbb" }] }];
    expect(approximateMessagesTokenCount(messages)).toBe(2);
  });
});
