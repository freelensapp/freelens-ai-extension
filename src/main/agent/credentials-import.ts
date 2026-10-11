import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { customProviderId } from "../../common/custom-provider";
import { isDefaultOpenAIBaseUrl } from "../../common/openai-base-url";
import { addCustomProvider } from "./custom-providers";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface LegacyCredentials {
  openAIKey: string;
  openAIBaseUrl: string;
  selectedModel: string;
}

export interface LegacyImportResult {
  /** "provider/id" of the model the chat should start on, when one was imported. */
  seededModel?: string;
}

/**
 * One-time move of the old OpenAI settings into pi's `auth.json`, so an
 * upgrading user keeps a working chat. A marker file makes it run once. The old
 * preference fields are left alone; ticket 14 clears them. A custom base URL
 * is left to importLegacyCustomProvider.
 */
export async function importLegacyCredentials(
  modelRuntime: ModelRuntime,
  legacy: LegacyCredentials,
  markerPath: string,
): Promise<LegacyImportResult> {
  if (existsSync(markerPath)) {
    return {};
  }

  const key = legacy.openAIKey.trim();
  let result: LegacyImportResult = {};
  if (key && isDefaultOpenAIBaseUrl(legacy.openAIBaseUrl)) {
    await modelRuntime.login("openai", "api_key", {
      prompt: async () => key,
      notify: () => undefined,
    });
    const model = legacy.selectedModel.trim();
    result = model ? { seededModel: `openai/${model}` } : {};
  }

  markDone(markerPath);
  return result;
}

export interface LegacyCustomEndpoint extends LegacyCredentials {
  /** The names of the old editable model list. */
  modelNames: string[];
}

/**
 * One-time move of an old custom "Base URL" with its key into a custom
 * OpenAI-compatible provider, carrying the old model ids. It has its own
 * marker, so builds that already ran the OpenAI key import still run it. When
 * it fails nothing is marked, so the next start tries again.
 */
export async function importLegacyCustomProvider(
  modelRuntime: ModelRuntime,
  modelsPath: string,
  legacy: LegacyCustomEndpoint,
  markerPath: string,
): Promise<LegacyImportResult> {
  if (existsSync(markerPath)) {
    return {};
  }

  const key = legacy.openAIKey.trim();
  let result: LegacyImportResult = {};
  if (key && !isDefaultOpenAIBaseUrl(legacy.openAIBaseUrl)) {
    const baseUrl = legacy.openAIBaseUrl.trim();
    const selected = legacy.selectedModel.trim();
    const host = new URL(baseUrl).host;
    const taken = new Set(modelRuntime.getProviders().map((provider) => provider.id));
    const name = taken.has(customProviderId(host)) ? `${host} (imported)` : host;
    const provider = await addCustomProvider(modelRuntime, modelsPath, {
      name,
      baseUrl,
      apiKey: key,
      modelIds: [...legacy.modelNames, selected],
      // The old endpoint got no reasoning effort unless it served OpenAI's own ids;
      // reasoning can be switched on in models.json.
      reasoning: false,
    });
    result = selected ? { seededModel: `${provider.id}/${selected}` } : {};
  }

  markDone(markerPath);
  return result;
}

const markDone = (markerPath: string) => {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${new Date().toISOString()}\n`);
};
