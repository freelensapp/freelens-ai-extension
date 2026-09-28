import { describe, expect, it } from "vitest";
import {
  AIProviders,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODELS,
  type ProviderConfig,
} from "./ai-models";
import {
  addModel,
  addProvider,
  changeProviderType,
  listModels,
  migrateLegacyProviders,
  modelKey,
  NO_SELECTION,
  normalizeName,
  parseModelKey,
  removeModel,
  removeProvider,
  resolveProviderApiKey,
  resolveSelection,
  sanitizeProviders,
  updateProvider,
} from "./provider-list";

const providers = (): ProviderConfig[] => [
  {
    id: "openai",
    name: "OpenAI",
    type: AIProviders.OPEN_AI,
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    apiKey: "sk-openai",
    models: ["gpt-5.5", "gpt-5.4"],
  },
  {
    id: "opencode",
    name: "OpenCode Go",
    type: AIProviders.ANTHROPIC,
    baseUrl: "https://opencode.ai/zen/go",
    apiKey: "{env:OPENCODE_API_KEY}",
    models: ["minimax-m2.7", "gpt-5.5"],
  },
];

describe("normalizeName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeName("  gpt-5.5  ")).toBe("gpt-5.5");
  });
});

describe("model keys", () => {
  it("round-trips a model name containing slashes", () => {
    const selection = { providerId: "openrouter", model: "anthropic/claude-sonnet-4-5" };
    expect(parseModelKey(modelKey(selection))).toEqual(selection);
  });
});

describe("listModels", () => {
  it("lists every model of every provider with its provider", () => {
    expect(listModels(providers()).map(modelKey)).toEqual([
      "openai/gpt-5.5",
      "openai/gpt-5.4",
      "opencode/minimax-m2.7",
      "opencode/gpt-5.5",
    ]);
    expect(listModels(providers())[2]?.providerName).toBe("OpenCode Go");
  });

  it("names an unnamed provider after its API", () => {
    const list = updateProvider(providers(), "opencode", { name: "  " });
    expect(listModels(list)[2]?.providerName).toBe("Anthropic-compatible");
  });
});

describe("resolveSelection", () => {
  it("keeps a valid selection", () => {
    expect(resolveSelection(providers(), { providerId: "opencode", model: "gpt-5.5" })).toEqual({
      providerId: "opencode",
      model: "gpt-5.5",
    });
  });

  it("matches a selection without provider (saved before the provider list) by model name", () => {
    expect(resolveSelection(providers(), { model: "minimax-m2.7" })).toEqual({
      providerId: "opencode",
      model: "minimax-m2.7",
    });
  });

  it("falls back to the first model when the selection is gone", () => {
    expect(resolveSelection(providers(), { providerId: "removed", model: "gpt-5.5" })).toEqual({
      providerId: "openai",
      model: "gpt-5.5",
    });
  });

  it("returns no selection when no provider has a model", () => {
    expect(resolveSelection([], { model: "gpt-5.5" })).toEqual(NO_SELECTION);
  });
});

describe("provider editing", () => {
  it("adds a provider with a unique name, the default base URL and no models", () => {
    const list = addProvider(addProvider([], AIProviders.ANTHROPIC), AIProviders.ANTHROPIC);
    expect(list.map((provider) => provider.name)).toEqual(["Anthropic-compatible", "Anthropic-compatible 2"]);
    expect(list[0]).toMatchObject({ baseUrl: DEFAULT_ANTHROPIC_BASE_URL, apiKey: "", models: [] });
    expect(list[0]?.id).not.toBe(list[1]?.id);
    expect(list[0]?.id).not.toContain("/");
  });

  it("removes a provider", () => {
    expect(removeProvider(providers(), "openai").map((provider) => provider.id)).toEqual(["opencode"]);
  });

  it("updates only the given provider", () => {
    const list = updateProvider(providers(), "openai", { apiKey: "sk-new" });
    expect(list[0]?.apiKey).toBe("sk-new");
    expect(list[1]).toEqual(providers()[1]);
  });

  it("moves a default base URL to the new API's default", () => {
    const list = changeProviderType(providers(), "openai", AIProviders.ANTHROPIC);
    expect(list[0]).toMatchObject({ type: AIProviders.ANTHROPIC, baseUrl: DEFAULT_ANTHROPIC_BASE_URL });
  });

  it("keeps a custom base URL when the API changes", () => {
    const list = changeProviderType(providers(), "opencode", AIProviders.OPEN_AI);
    expect(list[1]).toMatchObject({ type: AIProviders.OPEN_AI, baseUrl: "https://opencode.ai/zen/go" });
  });
});

describe("model editing", () => {
  it("adds a trimmed model to one provider", () => {
    const list = addModel(providers(), "opencode", "  glm-5.1 ");
    expect(list[1]?.models).toEqual(["minimax-m2.7", "gpt-5.5", "glm-5.1"]);
    expect(list[0]?.models).toEqual(["gpt-5.5", "gpt-5.4"]);
  });

  it("ignores empty and duplicate names", () => {
    const input = providers();
    expect(addModel(input, "openai", "   ")).toBe(input);
    expect(addModel(input, "openai", "gpt-5.5")).toBe(input);
  });

  it("allows the same model name on another provider", () => {
    expect(addModel(providers(), "opencode", "gpt-5.4")[1]?.models).toContain("gpt-5.4");
  });

  it("removes a model from one provider", () => {
    const list = removeModel(providers(), "openai", "gpt-5.5");
    expect(list[0]?.models).toEqual(["gpt-5.4"]);
    expect(list[1]?.models).toContain("gpt-5.5");
  });
});

describe("resolveProviderApiKey", () => {
  const openAI = { type: AIProviders.OPEN_AI, apiKey: "" };

  it("uses the stored key first", () => {
    expect(resolveProviderApiKey({ ...openAI, apiKey: " sk-stored " }, { OPENAI_API_KEY: "sk-env" })).toBe("sk-stored");
  });

  it("reads an {env:NAME} reference", () => {
    expect(resolveProviderApiKey({ ...openAI, apiKey: "{env:OPENCODE_API_KEY}" }, { OPENCODE_API_KEY: "sk-oc" })).toBe(
      "sk-oc",
    );
    expect(resolveProviderApiKey({ ...openAI, apiKey: "{env:OPENCODE_API_KEY}" }, {})).toBeUndefined();
  });

  it("falls back to the environment variable of the API", () => {
    expect(resolveProviderApiKey(openAI, { OPENAI_API_KEY: "sk-env" })).toBe("sk-env");
    expect(
      resolveProviderApiKey({ type: AIProviders.ANTHROPIC, apiKey: "" }, { OPENAI_API_KEY: "sk-env" }),
    ).toBeUndefined();
    expect(resolveProviderApiKey({ type: AIProviders.ANTHROPIC, apiKey: "" }, { ANTHROPIC_API_KEY: "sk-ant" })).toBe(
      "sk-ant",
    );
  });

  it("treats whitespace-only values as unset", () => {
    expect(resolveProviderApiKey({ ...openAI, apiKey: "   " }, { OPENAI_API_KEY: "  " })).toBeUndefined();
  });
});

describe("sanitizeProviders", () => {
  it("drops malformed entries and fills missing fields", () => {
    expect(
      sanitizeProviders([
        null,
        "x",
        { name: "no id" },
        { id: "a/b" },
        { id: "ok", type: "unknown", models: ["m", "m", 3, " "] },
      ]),
    ).toEqual([
      { id: "ok", name: "", type: AIProviders.OPEN_AI, baseUrl: DEFAULT_OPENAI_BASE_URL, apiKey: "", models: ["m"] },
    ]);
  });
});

describe("migrateLegacyProviders", () => {
  it("gives a fresh install the default provider", () => {
    expect(migrateLegacyProviders({})).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        type: AIProviders.OPEN_AI,
        baseUrl: DEFAULT_OPENAI_BASE_URL,
        apiKey: "",
        models: DEFAULT_OPENAI_MODELS,
      },
    ]);
  });

  it("keeps the OpenAI-compatible key, base URL and models", () => {
    expect(
      migrateLegacyProviders({
        openAIKey: "sk-old",
        openAIBaseUrl: "http://litellm:4000/v1",
        anthropicKey: "",
        models: [
          { provider: AIProviders.OPEN_AI, name: "gpt-5.5" },
          { provider: AIProviders.OPEN_AI, name: "deepseek-v4" },
        ],
      }),
    ).toEqual([
      {
        id: "openai",
        name: "OpenAI-compatible",
        type: AIProviders.OPEN_AI,
        baseUrl: "http://litellm:4000/v1",
        apiKey: "sk-old",
        models: ["gpt-5.5", "deepseek-v4"],
      },
    ]);
  });

  it("splits OpenAI and Anthropic models into two providers", () => {
    const migrated = migrateLegacyProviders({
      openAIKey: "sk-old",
      openAIBaseUrl: "",
      anthropicKey: "sk-ant",
      anthropicBaseUrl: "https://opencode.ai/zen/go",
      models: [
        { provider: AIProviders.OPEN_AI, name: "gpt-5.5" },
        { provider: AIProviders.ANTHROPIC, name: "minimax-m2.7" },
      ],
    });
    expect(
      migrated.map((provider) => [provider.id, provider.type, provider.baseUrl, provider.apiKey, provider.models]),
    ).toEqual([
      ["openai", AIProviders.OPEN_AI, DEFAULT_OPENAI_BASE_URL, "sk-old", ["gpt-5.5"]],
      ["anthropic", AIProviders.ANTHROPIC, "https://opencode.ai/zen/go", "sk-ant", ["minimax-m2.7"]],
    ]);
  });

  it("skips an unused OpenAI-compatible endpoint when only Anthropic was used", () => {
    const migrated = migrateLegacyProviders({
      openAIKey: "",
      anthropicKey: "sk-ant",
      models: [{ provider: AIProviders.ANTHROPIC, name: "claude-sonnet-4-5" }],
    });
    expect(migrated.map((provider) => provider.id)).toEqual(["anthropic"]);
  });

  it("restores the default models for an empty saved list, as the old versions did", () => {
    expect(migrateLegacyProviders({ openAIKey: "sk-old", models: [] })[0]?.models).toEqual(DEFAULT_OPENAI_MODELS);
  });
});
