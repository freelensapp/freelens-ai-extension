import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importLegacyCredentials } from "./credentials-import";

describe("importLegacyCredentials", () => {
  let dir: string;
  let authPath: string;
  let markerPath: string;
  let modelRuntime: ModelRuntime;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "credentials-import-"));
    authPath = join(dir, "pi", "auth.json");
    markerPath = join(dir, "pi", "legacy-import-done");
    modelRuntime = await ModelRuntime.create({ authPath, modelsPath: join(dir, "pi", "models.json") });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const legacy = { openAIKey: "sk-test-123", openAIBaseUrl: "https://api.openai.com/v1", selectedModel: "gpt-5.5" };

  it("moves the OpenAI key into auth.json and seeds the model", async () => {
    const result = await importLegacyCredentials(modelRuntime, legacy, markerPath);

    expect(result).toEqual({ seededModel: "openai/gpt-5.5" });
    expect(readFileSync(authPath, "utf8")).toContain("sk-test-123");
    expect(await modelRuntime.checkAuth("openai")).toBeTruthy();
  });

  it("runs only once", async () => {
    await importLegacyCredentials(modelRuntime, legacy, markerPath);
    expect(existsSync(markerPath)).toBe(true);

    await modelRuntime.logout("openai");
    const second = await importLegacyCredentials(modelRuntime, { ...legacy, openAIKey: "sk-other" }, markerPath);

    expect(second).toEqual({});
    expect(existsSync(authPath) ? readFileSync(authPath, "utf8") : "").not.toContain("sk-other");
  });

  it("imports nothing without a key, but still marks the import done", async () => {
    const result = await importLegacyCredentials(modelRuntime, { ...legacy, openAIKey: "  " }, markerPath);

    expect(result).toEqual({});
    expect(existsSync(markerPath)).toBe(true);
  });

  it("leaves a custom base URL for the custom provider import", async () => {
    const result = await importLegacyCredentials(
      modelRuntime,
      { ...legacy, openAIBaseUrl: "https://llm.example.com/v1" },
      markerPath,
    );

    expect(result).toEqual({});
    expect(existsSync(authPath) ? readFileSync(authPath, "utf8") : "").not.toContain("sk-test-123");
  });
});
