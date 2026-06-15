// Pure helpers for managing the editable model list. Kept free of any host
// (`@freelensapp/extensions`) or MobX dependency so they can be unit-tested in
// isolation and reused by the store, the preferences UI and the model provider.

import { type AIProviders, type CustomModel } from "./ai-models";

// Trim surrounding whitespace from a typed-in model name.
export const normalizeModelName = (name: string): string => name.trim();

// Whether the list already contains the given provider + name combination.
export const hasModel = (models: CustomModel[], provider: AIProviders, name: string): boolean =>
  models.some((model) => model.provider === provider && model.name === name);

// Return a new list with the model appended. No-op (returns the same list) when
// the name is empty after trimming or the provider + name pair already exists.
export const addModel = (models: CustomModel[], provider: AIProviders, rawName: string): CustomModel[] => {
  const name = normalizeModelName(rawName);
  if (!name || hasModel(models, provider, name)) {
    return models;
  }
  return [...models, { provider, name }];
};

// Return a new list with the entry at `index` removed.
export const removeModelAt = (models: CustomModel[], index: number): CustomModel[] =>
  models.filter((_, i) => i !== index);

// Provider for the first model matching `name`, or undefined if none matches.
export const findProvider = (models: CustomModel[], name: string): AIProviders | undefined =>
  models.find((model) => model.name === name)?.provider;

// Validate a stored/desired selection against the available models. Falls back
// to the first model when the selection is missing, and to "" for an empty list.
export const resolveSelectedModel = (models: CustomModel[], selected: string): string =>
  models.some((model) => model.name === selected) ? selected : (models[0]?.name ?? "");
