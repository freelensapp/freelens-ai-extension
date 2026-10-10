import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface LegacyCredentials {
  openAIKey: string;
  openAIBaseUrl: string;
  selectedModel: string;
}

export interface LegacyImportResult {
  /** "provider/id" of the model the chat should start on, when one was imported. */
  seededModel?: string;
}

const isDefaultBaseUrl = (baseUrl: string) => {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return trimmed === "" || trimmed === DEFAULT_OPENAI_BASE_URL;
};

/**
 * One-time move of the old OpenAI settings into pi's `auth.json`, so an
 * upgrading user keeps a working chat. A marker file makes it run once. The old
 * preference fields are left alone: AI Explain still reads them until it moves
 * to pi. A custom base URL becomes a custom provider in a later ticket.
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
  if (key && isDefaultBaseUrl(legacy.openAIBaseUrl)) {
    await modelRuntime.login("openai", "api_key", {
      prompt: async () => key,
      notify: () => undefined,
    });
    const model = legacy.selectedModel.trim();
    result = model ? { seededModel: `openai/${model}` } : {};
  }

  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, `${new Date().toISOString()}\n`);
  return result;
}
