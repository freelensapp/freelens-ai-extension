import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { customProviderId, validateCustomProvider } from "../../common/custom-provider";
import { isDefaultOpenAIBaseUrl } from "../../common/openai-base-url";
import useLog from "../utils/logger";
import { addCustomProvider, takenProviderIds } from "./custom-providers";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const { log } = useLog("freelens-ai");

export interface LegacyCredentials {
  openAIKey: string;
  openAIBaseUrl: string;
  selectedModel: string;
}

export interface LegacyImportResult {
  /** "provider/id" of the model the chat should start on, when one was imported. */
  seededModel?: string;
  /** The custom provider an old base URL became; its key is then in auth.json. */
  importedProviderId?: string;
}

/**
 * One-time move of the old OpenAI settings into pi's `auth.json`, so an
 * upgrading user keeps a working chat. A marker file makes it run once. The
 * caller clears the old preference fields afterwards. A custom base URL is left
 * to importLegacyCustomProvider.
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
    const host = URL.canParse(baseUrl) ? new URL(baseUrl).host : baseUrl;
    const taken = takenProviderIds(modelRuntime, modelsPath);
    const input = {
      name: taken.has(customProviderId(host)) ? `${host} (imported)` : host,
      baseUrl,
      apiKey: key,
      modelIds: [...legacy.modelNames, selected],
      // The old endpoint got no reasoning effort unless it served OpenAI's own ids;
      // reasoning can be switched on in models.json.
      reasoning: false,
    };
    // Input that can never become a provider would fail on every start; the
    // user can still add the endpoint on the settings page.
    const validation = validateCustomProvider(input, taken);
    if (!validation.ok) {
      log.warn(`The old base URL ${baseUrl} was not imported: ${validation.error}`);
      markDone(markerPath);
      return {};
    }
    const provider = await addCustomProvider(modelRuntime, modelsPath, input);
    result = { importedProviderId: provider.id, ...(selected ? { seededModel: `${provider.id}/${selected}` } : {}) };
  }

  markDone(markerPath);
  return result;
}

const markDone = (markerPath: string) => {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${new Date().toISOString()}\n`);
};
