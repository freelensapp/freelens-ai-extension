import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";
// Importing the module patches `BaseLanguageModel.prototype.getNumTokens` as a
// side effect, so every chat model instance counts tokens locally.
import { OfflineTokenChatOpenAI } from "./offline-token-chat-model";

describe("offline token counting", () => {
  it("counts tokens locally on the OfflineTokenChatOpenAI subclass", async () => {
    const model = new OfflineTokenChatOpenAI({ apiKey: "sk-test", model: "gpt-5.4" });
    await expect(model.getNumTokens("12345678")).resolves.toBe(2);
  });

  it("patches the base prototype so a plain ChatOpenAI never fetches", async () => {
    const model = new ChatOpenAI({ apiKey: "sk-test", model: "gpt-5.4" });
    // Guard against the tiktoken download: any network fetch must fail the test.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in test"));

    await expect(model.getNumTokens("123456789")).resolves.toBe(3);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("patches the inner worker instance ChatOpenAI delegates _generate to (issue #181)", async () => {
    // The `ChatOpenAI` facade delegates `_generate` (and its token counting) to
    // an internal `ChatOpenAICompletions` worker, not to the facade itself. This
    // is the instance the issue #181 stack trace reaches, so it must also count
    // tokens locally without touching the network.
    const model = new ChatOpenAI({ apiKey: "sk-test", model: "gpt-5.4" }) as ChatOpenAI & {
      completions: { getNumTokens(content: string): Promise<number> };
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in test"));

    await expect(model.completions.getNumTokens("123456789")).resolves.toBe(3);
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
