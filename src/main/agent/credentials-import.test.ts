import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importLegacyCredentials, importLegacyCustomProvider } from "./credentials-import";

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

describe("importLegacyCustomProvider", () => {
  let dir: string;
  let authPath: string;
  let modelsPath: string;
  let markerPath: string;
  let modelRuntime: ModelRuntime;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "custom-import-"));
    authPath = join(dir, "pi", "auth.json");
    modelsPath = join(dir, "pi", "models.json");
    markerPath = join(dir, "pi", "legacy-custom-import-done");
    modelRuntime = await ModelRuntime.create({ authPath, modelsPath });
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const legacy = {
    openAIKey: "sk-litellm-123",
    openAIBaseUrl: "https://llm.example.com/v1/",
    selectedModel: "qwen3",
    modelNames: ["gpt-5.5", "qwen3", "llama3"],
  };

  it("turns a custom base URL with a key into a custom provider with the old model ids", async () => {
    const result = await importLegacyCustomProvider(modelRuntime, modelsPath, legacy, markerPath);

    expect(result).toEqual({ importedProviderId: "llm-example-com", seededModel: "llm-example-com/qwen3" });
    expect(JSON.parse(readFileSync(modelsPath, "utf8")).providers["llm-example-com"]).toEqual({
      name: "llm.example.com",
      baseUrl: "https://llm.example.com/v1",
      api: "openai-completions",
      models: [
        { id: "gpt-5.5", reasoning: false },
        { id: "qwen3", reasoning: false },
        { id: "llama3", reasoning: false },
      ],
    });
    expect(readFileSync(modelsPath, "utf8")).not.toContain("sk-litellm-123");
    expect(readFileSync(authPath, "utf8")).toContain("sk-litellm-123");
    expect(await modelRuntime.checkAuth("llm-example-com")).toBeTruthy();
    expect(existsSync(markerPath)).toBe(true);
  });

  it("adds the selected model when the old list lacks it", async () => {
    await importLegacyCustomProvider(modelRuntime, modelsPath, { ...legacy, selectedModel: "mistral" }, markerPath);

    const models = JSON.parse(readFileSync(modelsPath, "utf8")).providers["llm-example-com"].models;
    expect(models.map((model: { id: string }) => model.id)).toEqual(["gpt-5.5", "qwen3", "llama3", "mistral"]);
  });

  it("runs only once", async () => {
    await importLegacyCustomProvider(modelRuntime, modelsPath, { ...legacy, openAIKey: "  " }, markerPath);
    expect(existsSync(markerPath)).toBe(true);

    const second = await importLegacyCustomProvider(modelRuntime, modelsPath, legacy, markerPath);

    expect(second).toEqual({});
    expect(existsSync(modelsPath)).toBe(false);
  });

  it("gives up for good on an old base URL that can never become a provider", async () => {
    for (const openAIBaseUrl of ["not a url", "ftp://llm.example.com/v1"]) {
      rmSync(markerPath, { force: true });
      expect(
        await importLegacyCustomProvider(modelRuntime, modelsPath, { ...legacy, openAIBaseUrl }, markerPath),
      ).toEqual({});
      expect(existsSync(markerPath)).toBe(true);
    }
    expect(existsSync(modelsPath)).toBe(false);
  });

  it("imports nothing for the default OpenAI base URL or without a key", async () => {
    expect(
      await importLegacyCustomProvider(
        modelRuntime,
        modelsPath,
        { ...legacy, openAIBaseUrl: "https://api.openai.com/v1" },
        markerPath,
      ),
    ).toEqual({});
    rmSync(markerPath);
    expect(
      await importLegacyCustomProvider(modelRuntime, modelsPath, { ...legacy, openAIKey: "" }, markerPath),
    ).toEqual({});
    expect(existsSync(modelsPath)).toBe(false);
  });
});
