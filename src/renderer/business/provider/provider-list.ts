// Pure helpers for managing the editable provider list. Kept free of any host
// (`@freelensapp/extensions`) or MobX dependency so they can be unit-tested in
// isolation and reused by the store, the preferences UI, the model provider and
// the main-process proxy.

import {
  AIProviders,
  createDefaultProviders,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  defaultBaseUrl,
  type LegacyCustomModel,
  PROVIDER_ENV_KEYS,
  PROVIDER_LABELS,
  type ProviderConfig,
} from "./ai-models";

// The model used by the chat: a model of one provider. Two providers may offer
// a model with the same name, so the name alone is not enough.
export interface ModelSelection {
  providerId: string;
  model: string;
}

// A selectable model, as listed in the chat dropdown.
export interface ModelOption extends ModelSelection {
  providerName: string;
}

export const NO_SELECTION: ModelSelection = { providerId: "", model: "" };

// Trim surrounding whitespace from a typed-in model or provider name.
export const normalizeName = (name: string): string => name.trim();

export const findProvider = (providers: ProviderConfig[], id: string): ProviderConfig | undefined =>
  providers.find((provider) => provider.id === id);

// Name shown for a provider, falling back to its API protocol when unnamed.
export const providerDisplayName = (provider: Pick<ProviderConfig, "name" | "type">): string =>
  normalizeName(provider.name) || PROVIDER_LABELS[provider.type] || provider.type;

// Provider ids never contain "/", so the first "/" of a key separates the id
// from the model name, which may contain "/" itself (e.g. OpenRouter ids).
export const modelKey = ({ providerId, model }: ModelSelection): string => `${providerId}/${model}`;

export const parseModelKey = (key: string): ModelSelection => {
  const separator = key.indexOf("/");
  return separator < 0
    ? { providerId: "", model: key }
    : { providerId: key.slice(0, separator), model: key.slice(separator + 1) };
};

// Every model of every provider, in list order.
export const listModels = (providers: ProviderConfig[]): ModelOption[] =>
  providers.flatMap((provider) =>
    provider.models.map((model) => ({ providerId: provider.id, providerName: providerDisplayName(provider), model })),
  );

// Validate a stored/desired selection against the provider list. A selection
// without a provider (saved before the provider list) matches the first
// provider offering that model. Falls back to the first available model, and to
// NO_SELECTION when no provider has a model.
export const resolveSelection = (providers: ProviderConfig[], selected: Partial<ModelSelection>): ModelSelection => {
  const models = listModels(providers);
  const match = models.find(
    (option) => option.model === selected.model && (!selected.providerId || option.providerId === selected.providerId),
  );
  const resolved = match ?? models[0];
  return resolved ? { providerId: resolved.providerId, model: resolved.model } : NO_SELECTION;
};

const createProviderId = (providers: ProviderConfig[]): string => {
  let id: string;
  do {
    id = `p-${Math.random().toString(36).slice(2, 10)}`;
  } while (findProvider(providers, id));
  return id;
};

// First "<label>", "<label> 2", ... not used by another provider.
const uniqueName = (providers: ProviderConfig[], base: string): string => {
  const names = new Set(providers.map((provider) => normalizeName(provider.name)));
  let name = base;
  for (let suffix = 2; names.has(name); suffix++) {
    name = `${base} ${suffix}`;
  }
  return name;
};

// Return a new list with an empty provider of the given type appended.
export const addProvider = (providers: ProviderConfig[], type: AIProviders): ProviderConfig[] => [
  ...providers,
  {
    id: createProviderId(providers),
    name: uniqueName(providers, PROVIDER_LABELS[type]),
    type,
    baseUrl: defaultBaseUrl(type),
    apiKey: "",
    models: [],
  },
];

export const removeProvider = (providers: ProviderConfig[], id: string): ProviderConfig[] =>
  providers.filter((provider) => provider.id !== id);

// Return a new list with the provider's fields replaced. The id never changes.
export const updateProvider = (
  providers: ProviderConfig[],
  id: string,
  patch: Partial<Omit<ProviderConfig, "id">>,
): ProviderConfig[] => providers.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider));

// Switch the API protocol. A base URL still at the old protocol's default (or
// empty) follows the new protocol; a custom one is kept.
export const changeProviderType = (providers: ProviderConfig[], id: string, type: AIProviders): ProviderConfig[] => {
  const provider = findProvider(providers, id);
  if (!provider || provider.type === type) {
    return providers;
  }
  const keepBaseUrl = provider.baseUrl.trim() && provider.baseUrl.trim() !== defaultBaseUrl(provider.type);
  return updateProvider(providers, id, { type, baseUrl: keepBaseUrl ? provider.baseUrl : defaultBaseUrl(type) });
};

// Return a new list with the model added to the provider. No-op (returns the
// same list) when the name is empty after trimming or the provider already has it.
export const addModel = (providers: ProviderConfig[], id: string, rawName: string): ProviderConfig[] => {
  const name = normalizeName(rawName);
  const provider = findProvider(providers, id);
  if (!name || !provider || provider.models.includes(name)) {
    return providers;
  }
  return updateProvider(providers, id, { models: [...provider.models, name] });
};

export const removeModel = (providers: ProviderConfig[], id: string, name: string): ProviderConfig[] => {
  const provider = findProvider(providers, id);
  return provider
    ? updateProvider(providers, id, { models: provider.models.filter((model) => model !== name) })
    : providers;
};

type Env = Record<string, string | undefined>;

const ENV_REFERENCE = /^\{env:([^}]+)\}$/;

// The API key sent for a provider, resolved from its `apiKey` field:
//   - "{env:NAME}": the NAME environment variable, as in the OpenCode config;
//   - a key: the key itself;
//   - empty: OPENAI_API_KEY or ANTHROPIC_API_KEY, depending on the protocol.
// Returns undefined when nothing is set, letting the upstream answer with its
// own 401. Used by the main-process proxy and by the renderer readiness check,
// so both agree on whether a provider has a key.
export const resolveProviderApiKey = (
  provider: Pick<ProviderConfig, "type" | "apiKey">,
  env: Env | undefined,
): string | undefined => {
  const apiKey = provider.apiKey.trim();
  const reference = apiKey.match(ENV_REFERENCE);
  const key = reference ? env?.[reference[1].trim()] : apiKey || env?.[PROVIDER_ENV_KEYS[provider.type]];
  return key?.trim() || undefined;
};

const isProviderType = (value: unknown): value is AIProviders =>
  Object.values(AIProviders).includes(value as AIProviders);

// Keep only well-formed entries of a persisted provider list, so a hand-edited
// or corrupt preferences file cannot crash the renderer.
export const sanitizeProviders = (raw: unknown[]): ProviderConfig[] =>
  raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as Partial<ProviderConfig>;
    if (typeof candidate.id !== "string" || !candidate.id || candidate.id.includes("/")) {
      return [];
    }
    const type = isProviderType(candidate.type) ? candidate.type : AIProviders.OPEN_AI;
    const models = Array.isArray(candidate.models)
      ? [...new Set(candidate.models.filter((model): model is string => typeof model === "string" && !!model.trim()))]
      : [];
    return [
      {
        id: candidate.id,
        name: typeof candidate.name === "string" ? candidate.name : "",
        type,
        baseUrl: typeof candidate.baseUrl === "string" ? candidate.baseUrl : defaultBaseUrl(type),
        apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : "",
        models,
      },
    ];
  });

// Preferences saved before the provider list: one OpenAI-compatible and one
// Anthropic-compatible endpoint, plus a flat model list tagged with the protocol.
export interface LegacyProviderPreferences {
  openAIKey?: string;
  openAIBaseUrl?: string;
  anthropicKey?: string;
  anthropicBaseUrl?: string;
  models?: LegacyCustomModel[];
}

// Convert the old per-protocol settings into providers with the same key, base
// URL and models, so an upgrade keeps working without touching the preferences.
// The Anthropic provider is created only when it was used. A fresh install (no
// old settings at all) gets the default provider list.
export const migrateLegacyProviders = (legacy: LegacyProviderPreferences): ProviderConfig[] => {
  const hasLegacySettings =
    legacy.models !== undefined ||
    legacy.openAIKey !== undefined ||
    legacy.openAIBaseUrl !== undefined ||
    legacy.anthropicKey !== undefined;
  if (!hasLegacySettings) {
    return createDefaultProviders();
  }

  // An empty saved list fell back to the default models in the old versions.
  const legacyModels = legacy.models?.length
    ? legacy.models
    : createDefaultProviders()[0].models.map((name) => ({ provider: AIProviders.OPEN_AI, name }));
  const modelsOf = (type: AIProviders) => [
    ...new Set(
      legacyModels
        .filter(
          (model) => (model.provider === AIProviders.ANTHROPIC ? AIProviders.ANTHROPIC : AIProviders.OPEN_AI) === type,
        )
        .map((model) => normalizeName(model.name ?? ""))
        .filter(Boolean),
    ),
  ];

  const anthropicModels = modelsOf(AIProviders.ANTHROPIC);
  const anthropicKey = legacy.anthropicKey ?? "";
  const providers: ProviderConfig[] = [];

  const openAIModels = modelsOf(AIProviders.OPEN_AI);
  const openAIKey = legacy.openAIKey ?? "";
  if (openAIModels.length > 0 || openAIKey || anthropicModels.length === 0) {
    providers.push({
      id: "openai",
      name: PROVIDER_LABELS[AIProviders.OPEN_AI],
      type: AIProviders.OPEN_AI,
      baseUrl: legacy.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL,
      apiKey: openAIKey,
      models: openAIModels,
    });
  }

  if (anthropicModels.length > 0 || anthropicKey) {
    providers.push({
      id: "anthropic",
      name: PROVIDER_LABELS[AIProviders.ANTHROPIC],
      type: AIProviders.ANTHROPIC,
      baseUrl: legacy.anthropicBaseUrl || DEFAULT_ANTHROPIC_BASE_URL,
      apiKey: anthropicKey,
      models: anthropicModels,
    });
  }

  return providers;
};
