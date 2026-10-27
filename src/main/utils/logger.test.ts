import { afterEach, describe, expect, it, vi } from "vitest";
import useLog from "./logger";

describe("the main-process logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes errors with the scope prefix and the credentials redacted", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { log } = useLog("freelens-ai");

    log.error("Starting the pi agent failed:", { provider: "openai", apiKey: "sk-secret" });

    expect(consoleError).toHaveBeenCalledWith("[freelens-ai] Starting the pi agent failed:", {
      provider: "openai",
      apiKey: "<redacted>",
    });
  });

  it("writes warnings", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { log } = useLog("freelens-ai");

    log.warn("The old base URL was not imported");

    expect(consoleWarn).toHaveBeenCalledWith("[freelens-ai] The old base URL was not imported");
  });
});
