import { describe, expect, it } from "vitest";
import { approximateTokenCount, messageContentToText } from "./token-estimate";

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
