import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateAzureCredential, renameAzureModelRef } from "./azure-rename";

describe("migrateAzureCredential", () => {
  let dir: string;
  let authPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "azure-rename-"));
    authPath = join(dir, "pi", "auth.json");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const writeAuth = (data: Record<string, unknown>) => {
    mkdirSync(join(dir, "pi"), { recursive: true });
    writeFileSync(authPath, JSON.stringify(data));
  };
  const createRuntime = () => ModelRuntime.create({ authPath, modelsPath: join(dir, "pi", "models.json") });

  it("moves a key saved under azure-openai-responses to azure, so Azure stays connected", async () => {
    writeAuth({ "azure-openai-responses": { type: "api_key", key: "az-key-1" } });
    const modelRuntime = await createRuntime();

    await migrateAzureCredential(modelRuntime, authPath);

    expect(await modelRuntime.checkAuth("azure")).toMatchObject({ type: "api_key" });
    expect(readStoredCredential("azure", authPath)).toMatchObject({ type: "api_key", key: "az-key-1" });
    expect(readStoredCredential("azure-openai-responses", authPath)).toBeUndefined();
  });

  it("keeps a key already saved under azure and drops the old one", async () => {
    writeAuth({
      "azure-openai-responses": { type: "api_key", key: "az-old" },
      azure: { type: "api_key", key: "az-new" },
    });
    const modelRuntime = await createRuntime();

    await migrateAzureCredential(modelRuntime, authPath);

    expect(readStoredCredential("azure", authPath)).toMatchObject({ key: "az-new" });
    expect(readStoredCredential("azure-openai-responses", authPath)).toBeUndefined();
  });

  it("leaves auth.json alone when nothing is saved under the old id", async () => {
    writeAuth({ openai: { type: "api_key", key: "sk-1" } });
    const before = readFileSync(authPath, "utf8");
    const modelRuntime = await createRuntime();

    await migrateAzureCredential(modelRuntime, authPath);

    expect(readFileSync(authPath, "utf8")).toBe(before);
  });
});

describe("renameAzureModelRef", () => {
  it("moves a saved Azure model to the azure provider", () => {
    expect(renameAzureModelRef("azure-openai-responses/gpt-5.4")).toBe("azure/gpt-5.4");
  });

  it("leaves other models as they are", () => {
    expect(renameAzureModelRef("azure/gpt-5.4")).toBe("azure/gpt-5.4");
    expect(renameAzureModelRef("openai/gpt-5.5")).toBe("openai/gpt-5.5");
    expect(renameAzureModelRef("")).toBe("");
  });
});
