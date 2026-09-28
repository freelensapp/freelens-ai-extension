import { describe, expect, it } from "vitest";
import { AIProviders, type ProviderConfig } from "./ai-models";
import { buildAgentReadinessInput, isAgentConfigured } from "./chat-readiness";

const provider = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: "openai",
  name: "OpenAI",
  type: AIProviders.OPEN_AI,
  baseUrl: "",
  apiKey: "sk-test",
  models: ["gpt-5.5", "gpt-5.4"],
  ...overrides,
});

const input = (providers: ProviderConfig[], selectedProviderId = "openai", selectedModel = "gpt-5.5") => ({
  providers,
  selectedProviderId,
  selectedModel,
  env: {},
});

describe("isAgentConfigured", () => {
  it("is not configured without providers", () => {
    expect(isAgentConfigured(input([], "", ""))).toBe(false);
  });

  it("is not configured without an API key", () => {
    expect(isAgentConfigured(input([provider({ apiKey: "" })]))).toBe(false);
    expect(isAgentConfigured(input([provider({ apiKey: "   " })]))).toBe(false);
  });

  it("is configured with a model and a key", () => {
    expect(isAgentConfigured(input([provider()]))).toBe(true);
  });

  it("is not configured when the selected model or provider no longer exists", () => {
    expect(isAgentConfigured(input([provider()], "openai", "removed"))).toBe(false);
    expect(isAgentConfigured(input([provider()], "removed", "gpt-5.5"))).toBe(false);
  });

  it("uses the key of the selected model's provider only", () => {
    const providers = [
      provider({ apiKey: "" }),
      provider({ id: "claude", type: AIProviders.ANTHROPIC, apiKey: "sk-ant", models: ["claude-sonnet-4-5"] }),
    ];
    expect(isAgentConfigured(input(providers, "claude", "claude-sonnet-4-5"))).toBe(true);
    expect(isAgentConfigured(input(providers, "openai", "gpt-5.5"))).toBe(false);
  });
});

describe("buildAgentReadinessInput", () => {
  const prefsWithoutStoredKey = {
    providers: [provider({ apiKey: "" })],
    selectedProviderId: "openai",
    selectedModel: "gpt-5.5",
  };

  it("picks up the key from the environment", () => {
    expect(isAgentConfigured(buildAgentReadinessInput(prefsWithoutStoredKey, { OPENAI_API_KEY: "sk-env" }))).toBe(true);
  });

  // Passing `undefined` would fall back to the real `process.env`, so an empty
  // object stands in for "no environment key set".
  it("is not configured without an environment key and without a stored key", () => {
    expect(isAgentConfigured(buildAgentReadinessInput(prefsWithoutStoredKey, {}))).toBe(false);
  });

  it("treats a whitespace-only environment key as unset", () => {
    expect(isAgentConfigured(buildAgentReadinessInput(prefsWithoutStoredKey, { OPENAI_API_KEY: "   " }))).toBe(false);
  });

  it("resolves an {env:NAME} key like the proxy", () => {
    const prefs = { ...prefsWithoutStoredKey, providers: [provider({ apiKey: "{env:OPENCODE_API_KEY}" })] };
    expect(isAgentConfigured(buildAgentReadinessInput(prefs, { OPENCODE_API_KEY: "sk-oc" }))).toBe(true);
    expect(isAgentConfigured(buildAgentReadinessInput(prefs, { OPENAI_API_KEY: "sk-env" }))).toBe(false);
  });
});
