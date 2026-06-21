import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";
// Importing the module applies the `ChatOpenAI.prototype.getNumTokens` patch as
// a side effect, so a plain base `ChatOpenAI` must also count tokens locally.
import { OfflineTokenChatOpenAI } from "./offline-token-chat-model";

describe("offline token counting", () => {
  it("counts tokens locally on the OfflineTokenChatOpenAI subclass", async () => {
    const model = new OfflineTokenChatOpenAI({ apiKey: "sk-test", model: "gpt-5.4" });
    await expect(model.getNumTokens("12345678")).resolves.toBe(2);
  });

  it("patches the base ChatOpenAI prototype so internal instances never fetch", async () => {
    const model = new ChatOpenAI({ apiKey: "sk-test", model: "gpt-5.4" });
    // Guard against the tiktoken download: any network fetch must fail the test.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in test"));

    await expect(model.getNumTokens("123456789")).resolves.toBe(3);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
