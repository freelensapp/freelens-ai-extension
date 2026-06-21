import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { describe, expect, it } from "vitest";
import { ensureRunnableContextStorage } from "./runnable-context";

describe("ensureRunnableContextStorage", () => {
  it("installs a storage that survives across an await boundary", async () => {
    ensureRunnableContextStorage();

    const config = { tags: ["unit-test"] };
    const storage = AsyncLocalStorageProviderSingleton.getInstance();

    const seen = await storage.run({ extra: { [Symbol.for("lc:child_config")]: config } }, async () => {
      // An await turns the synchronous run() body into a continuation; only a
      // real AsyncLocalStorage preserves the store across it. The default mock
      // returns undefined here, which is exactly the bug this guards against.
      await Promise.resolve();
      return AsyncLocalStorageProviderSingleton.getRunnableConfig();
    });

    expect(seen).toBe(config);
  });

  it("is idempotent — repeated calls keep the first instance", () => {
    ensureRunnableContextStorage();
    const first = AsyncLocalStorageProviderSingleton.getInstance();
    ensureRunnableContextStorage();
    expect(AsyncLocalStorageProviderSingleton.getInstance()).toBe(first);
  });
});
