import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { type CustomProvider, type CustomProviderInput, validateCustomProvider } from "../../common/custom-provider";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

// pi only makes a models.json provider available once it has a credential, so
// an endpoint without auth (a local Ollama) gets this placeholder, which such
// servers ignore. It is the value pi's own docs use for Ollama.
const NO_KEY = "none";

interface ModelsJsonProvider {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  models?: { id: string }[];
  [field: string]: unknown;
}

interface ModelsJson {
  providers: Record<string, ModelsJsonProvider>;
  [field: string]: unknown;
}

const readModelsJson = (modelsPath: string): ModelsJson => {
  if (!existsSync(modelsPath)) {
    return { providers: {} };
  }
  const parsed = JSON.parse(readFileSync(modelsPath, "utf8")) as Partial<ModelsJson>;
  return { ...parsed, providers: parsed.providers ?? {} };
};

// Through a temporary file, so pi never reads a half-written models.json.
const writeModelsJson = (modelsPath: string, config: ModelsJson) => {
  mkdirSync(dirname(modelsPath), { recursive: true });
  const temporary = `${modelsPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(temporary, modelsPath);
};

const builtinIds = new Set<string>(getBuiltinProviders());

/**
 * The custom endpoints in models.json: providers it defines with their own
 * base URL and models that are not pi built-ins, whether added through the
 * settings page or by hand.
 */
export const readCustomProviders = (modelsPath: string): Map<string, { baseUrl: string }> => {
  const custom = new Map<string, { baseUrl: string }>();
  let config: ModelsJson;
  try {
    config = readModelsJson(modelsPath);
  } catch {
    // pi reports a broken models.json itself; the cards just show no custom endpoints.
    return custom;
  }
  for (const [id, provider] of Object.entries(config.providers)) {
    if (!builtinIds.has(id) && provider.baseUrl && provider.models?.length) {
      custom.set(id, { baseUrl: provider.baseUrl });
    }
  }
  return custom;
};

const reloadProvider = async (modelRuntime: ModelRuntime, providerId: string) => {
  await modelRuntime.refresh({ providers: [providerId], allowNetwork: false });
};

/**
 * Writes an OpenAI-compatible endpoint into models.json and its key into pi's
 * auth.json, so the key never sits in models.json. Throws, leaving models.json
 * as it was, when the input is invalid or pi cannot load the endpoint.
 */
export async function addCustomProvider(
  modelRuntime: ModelRuntime,
  modelsPath: string,
  input: CustomProviderInput,
): Promise<CustomProvider> {
  const taken = new Set(modelRuntime.getProviders().map((provider) => provider.id));
  const validation = validateCustomProvider(input, taken);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const { provider } = validation;

  const previous = readModelsJson(modelsPath);
  writeModelsJson(modelsPath, {
    ...previous,
    providers: {
      ...previous.providers,
      [provider.id]: {
        name: provider.name,
        baseUrl: provider.baseUrl,
        api: "openai-completions",
        ...(provider.apiKey ? {} : { apiKey: NO_KEY }),
        models: provider.modelIds.map((id) => ({ id, reasoning: provider.reasoning })),
      },
    },
  });

  try {
    await reloadProvider(modelRuntime, provider.id);
    if (!modelRuntime.getProvider(provider.id)) {
      throw new Error(`pi could not load ${provider.name}.`);
    }
    if (provider.apiKey) {
      const key = provider.apiKey;
      await modelRuntime.login(provider.id, "api_key", { prompt: async () => key, notify: () => undefined });
    }
  } catch (error) {
    writeModelsJson(modelsPath, previous);
    await reloadProvider(modelRuntime, provider.id).catch(() => undefined);
    throw error;
  }
  return provider;
}

/** Deletes a custom endpoint from models.json and its saved key from auth.json. */
export async function removeCustomProvider(
  modelRuntime: ModelRuntime,
  modelsPath: string,
  providerId: string,
): Promise<void> {
  if (!readCustomProviders(modelsPath).has(providerId)) {
    const name = modelRuntime.getProvider(providerId)?.name ?? providerId;
    throw new Error(`${name} is not a custom endpoint.`);
  }
  const stored = (await modelRuntime.listCredentials()).some((credential) => credential.providerId === providerId);
  if (stored) {
    await modelRuntime.logout(providerId);
  }
  const config = readModelsJson(modelsPath);
  const { [providerId]: _removed, ...providers } = config.providers;
  writeModelsJson(modelsPath, { ...config, providers });
  await reloadProvider(modelRuntime, providerId);
}
