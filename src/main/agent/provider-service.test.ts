import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderService, type ProviderServiceOptions } from "./provider-service";

import type { ApiKeyCredential, AuthPrompt, Provider, ProviderAuth } from "@earendil-works/pi-ai";

import type {
  LoginPrompt,
  ProviderEnvelope,
  ProviderModelSummary,
  ProviderSummary,
} from "../../common/provider-protocol";

// A provider of pi's shape with scripted auth, so logins run without a network.
const fakeProvider = (id: string, name: string, auth: ProviderAuth): Provider => {
  const faux = fauxProvider({ provider: id, models: [{ id: `${id}-model`, name: `${name} Model` }] });
  return { ...faux.provider, id, name, auth };
};

// API-key auth that keeps the key in the credential, or reads it from `envVar`.
const apiKeyAuth = (
  name: string,
  login: (prompt: (prompt: AuthPrompt) => Promise<string>) => Promise<ApiKeyCredential>,
  envVar?: string,
): ProviderAuth => ({
  apiKey: {
    name,
    login: (interaction) => login((prompt) => interaction.prompt(prompt)),
    resolve: async ({ ctx, credential }) => {
      const key = credential?.key ?? (envVar ? await ctx.env(envVar) : undefined);
      return key ? { auth: { apiKey: key }, source: credential?.key ? "stored credential" : envVar } : undefined;
    },
  },
});

describe("ProviderService", () => {
  let dataDir: string;
  let authPath: string;
  let modelRuntime: ModelRuntime;
  let envelopes: ProviderEnvelope[];
  let service: ProviderService | undefined;
  const savedEnv = process.env.FAKE_ENV_KEY;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "provider-service-"));
    authPath = join(dataDir, "pi", "auth.json");
    modelRuntime = await ModelRuntime.create({ authPath, modelsPath: join(dataDir, "pi", "models.json") });
    modelRuntime.registerNativeProvider(
      fakeProvider(
        "fake-key",
        "Fake Key",
        apiKeyAuth("Fake API key", async (prompt) => ({
          type: "api_key",
          key: await prompt({ type: "secret", message: "Enter Fake API key" }),
        })),
      ),
    );
    modelRuntime.registerNativeProvider(
      fakeProvider(
        "fake-cloud",
        "Fake Cloud",
        apiKeyAuth("Fake Cloud credentials", async (prompt) => {
          const method = await prompt({
            type: "select",
            message: "Choose how to authenticate",
            options: [
              { id: "key", label: "API key" },
              { id: "profile", label: "Profile" },
            ],
          });
          const value = await prompt({ type: "secret", message: `Enter the ${method}` });
          return { type: "api_key", key: `${method}:${value}` };
        }),
      ),
    );
    modelRuntime.registerNativeProvider(
      fakeProvider(
        "fake-env",
        "Fake Env",
        apiKeyAuth(
          "Fake Env API key",
          async (prompt) => ({ type: "api_key", key: await prompt({ type: "secret", message: "Key" }) }),
          "FAKE_ENV_KEY",
        ),
      ),
    );
    envelopes = [];
    delete process.env.FAKE_ENV_KEY;
  });

  afterEach(() => {
    service?.dispose();
    service = undefined;
    if (savedEnv === undefined) delete process.env.FAKE_ENV_KEY;
    else process.env.FAKE_ENV_KEY = savedEnv;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const createService = (overrides: Partial<ProviderServiceOptions> = {}) => {
    service = new ProviderService({ modelRuntime, broadcast: (envelope) => envelopes.push(envelope), ...overrides });
    return service;
  };

  const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  const prompts = () => envelopes.flatMap((e) => (e.kind === "ui_request" ? [e.payload] : []));
  const waitForPrompt = async (count: number): Promise<LoginPrompt> => {
    await waitFor(() => prompts().length >= count);
    return prompts()[count - 1]!;
  };

  const listProviders = async (svc: ProviderService) => {
    const response = await svc.handleCommand({ type: "list_providers" });
    expect(response.success).toBe(true);
    return (response.success ? response.data : []) as ProviderSummary[];
  };
  const provider = async (svc: ProviderService, id: string) => (await listProviders(svc)).find((p) => p.id === id)!;

  it("lists pi's built-in providers with their login methods, not connected by default", async () => {
    const svc = createService();
    const providers = await listProviders(svc);

    const openai = providers.find((p) => p.id === "openai");
    expect(openai).toMatchObject({
      name: "OpenAI",
      status: { connected: false, stored: false },
      methods: [
        { type: "api_key", label: "OpenAI API key" },
        { type: "oauth", label: "Sign in with ChatGPT", isSubscription: true },
      ],
    });
    expect(openai!.modelCount).toBeGreaterThan(0);
    expect((await provider(svc, "fake-key")).status.connected).toBe(false);
  });

  it("logs in with a secret prompt and saves the key only in auth.json", async () => {
    const svc = createService();

    const login = svc.handleCommand({ type: "login", loginId: "l1", providerId: "fake-key", method: "api_key" });
    const prompt = await waitForPrompt(1);
    expect(prompt).toMatchObject({ type: "secret", message: "Enter Fake API key" });

    expect(await svc.handleCommand({ type: "ui_response", id: prompt.id, value: "sk-fake-123" })).toMatchObject({
      success: true,
    });
    expect(await login).toMatchObject({ success: true });

    expect((await provider(svc, "fake-key")).status).toEqual({
      connected: true,
      type: "api_key",
      source: "stored credential",
      stored: true,
    });
    expect(readFileSync(authPath, "utf8")).toContain("sk-fake-123");
    expect(JSON.stringify(envelopes)).not.toContain("sk-fake-123");
    expect(envelopes.at(-1)).toMatchObject({ kind: "login_end", loginId: "l1", payload: { success: true } });
  });

  it("runs a select then a secret prompt", async () => {
    const svc = createService();

    const login = svc.handleCommand({ type: "login", loginId: "l1", providerId: "fake-cloud", method: "api_key" });
    const select = await waitForPrompt(1);
    expect(select).toMatchObject({
      type: "select",
      options: [
        { id: "key", label: "API key" },
        { id: "profile", label: "Profile" },
      ],
    });
    await svc.handleCommand({ type: "ui_response", id: select.id, value: "profile" });

    const secret = await waitForPrompt(2);
    expect(secret).toMatchObject({ type: "secret", message: "Enter the profile" });
    await svc.handleCommand({ type: "ui_response", id: secret.id, value: "s3cret" });

    expect(await login).toMatchObject({ success: true });
    expect((await provider(svc, "fake-cloud")).status.connected).toBe(true);
    expect(readFileSync(authPath, "utf8")).toContain("profile:s3cret");
  });

  it("cancels a login without saving anything", async () => {
    const svc = createService();

    const login = svc.handleCommand({ type: "login", loginId: "l1", providerId: "fake-key", method: "api_key" });
    await waitForPrompt(1);
    expect(await svc.handleCommand({ type: "cancel_login", loginId: "l1" })).toMatchObject({ success: true });

    expect(await login).toEqual({ type: "response", command: "login", success: false, error: "Login cancelled." });
    expect((await provider(svc, "fake-key")).status.connected).toBe(false);
    expect(envelopes.at(-1)).toMatchObject({
      kind: "login_end",
      payload: { success: false, error: "Login cancelled." },
    });
  });

  it("ignores a cancel meant for an earlier login", async () => {
    const svc = createService();

    const login = svc.handleCommand({ type: "login", loginId: "l2", providerId: "fake-key", method: "api_key" });
    const prompt = await waitForPrompt(1);
    expect(await svc.handleCommand({ type: "cancel_login", loginId: "l1" })).toMatchObject({ success: true });

    await svc.handleCommand({ type: "ui_response", id: prompt.id, value: "sk-still-running" });
    expect(await login).toMatchObject({ success: true });
  });

  it("cancels a login when the prompt is cancelled", async () => {
    const svc = createService();

    const login = svc.handleCommand({ type: "login", loginId: "l1", providerId: "fake-key", method: "api_key" });
    const prompt = await waitForPrompt(1);
    await svc.handleCommand({ type: "ui_response", id: prompt.id, cancelled: true });

    expect(await login).toMatchObject({ success: false, error: "Login cancelled." });
    expect((await provider(svc, "fake-key")).status.connected).toBe(false);
  });

  it("cancels the previous login when a new one starts", async () => {
    const svc = createService();

    const first = svc.handleCommand({ type: "login", loginId: "l1", providerId: "fake-key", method: "api_key" });
    await waitForPrompt(1);
    const second = svc.handleCommand({ type: "login", loginId: "l2", providerId: "fake-key", method: "api_key" });

    expect(await first).toMatchObject({ success: false, error: "Login cancelled." });
    const prompt = await waitForPrompt(2);
    const request = envelopes.find((e) => e.kind === "ui_request" && e.payload.id === prompt.id);
    expect(request?.kind === "ui_request" ? request.loginId : undefined).toBe("l2");
    await svc.handleCommand({ type: "ui_response", id: prompt.id, value: "sk-second" });
    expect(await second).toMatchObject({ success: true });
  });

  it("refuses an answer for a prompt it is not waiting on", async () => {
    const svc = createService();
    expect(await svc.handleCommand({ type: "ui_response", id: "nope", value: "x" })).toMatchObject({
      success: false,
    });
  });

  it("logs out of a stored credential", async () => {
    const svc = createService();
    const login = svc.handleCommand({ type: "login", loginId: "l1", providerId: "fake-key", method: "api_key" });
    await svc.handleCommand({ type: "ui_response", id: (await waitForPrompt(1)).id, value: "sk-fake" });
    await login;

    expect(await svc.handleCommand({ type: "logout", providerId: "fake-key" })).toMatchObject({ success: true });

    expect((await provider(svc, "fake-key")).status).toEqual({ connected: false, stored: false });
    expect(readFileSync(authPath, "utf8")).not.toContain("sk-fake");
  });

  it("tells every window that the credentials changed after a login and a logout", async () => {
    const svc = createService();
    const changes = () => envelopes.filter((e) => e.kind === "credentials_changed").length;
    const login = svc.handleCommand({ type: "login", loginId: "l1", providerId: "fake-key", method: "api_key" });
    await svc.handleCommand({ type: "ui_response", id: (await waitForPrompt(1)).id, value: "sk-fake" });
    await login;
    expect(changes()).toBe(1);

    await svc.handleCommand({ type: "logout", providerId: "fake-key" });
    expect(changes()).toBe(2);
    expect(JSON.stringify(envelopes)).not.toContain("sk-fake");
  });

  it("shows a provider whose key comes from an environment variable as connected, without logout", async () => {
    process.env.FAKE_ENV_KEY = "from-env";
    const svc = createService();

    expect((await provider(svc, "fake-env")).status).toEqual({
      connected: true,
      type: "api_key",
      source: "FAKE_ENV_KEY",
      stored: false,
    });
    expect(await svc.handleCommand({ type: "logout", providerId: "fake-env" })).toMatchObject({
      success: false,
      error: "Fake Env uses FAKE_ENV_KEY. Remove the environment variable to disconnect it.",
    });
  });

  it("lists the models of connected providers with context and prices", async () => {
    process.env.FAKE_ENV_KEY = "from-env";
    const svc = createService();

    const response = await svc.handleCommand({ type: "list_models" });
    const models = (response.success ? response.data : []) as ProviderModelSummary[];

    expect(models.filter((m) => m.provider.startsWith("fake-"))).toEqual([
      expect.objectContaining({
        provider: "fake-env",
        providerName: "Fake Env",
        id: "fake-env-model",
        name: "Fake Env Model",
      }),
    ]);
    expect(models[0]).toHaveProperty("contextWindow");
    expect(models[0]).toHaveProperty("inputCost");
  });

  it("forwards login progress as login_event envelopes", async () => {
    modelRuntime.registerNativeProvider(
      fakeProvider("fake-oauth", "Fake OAuth", {
        oauth: {
          name: "Fake OAuth",
          loginLabel: "Sign in with Fake",
          isSubscription: true,
          login: async (interaction) => {
            interaction.notify({ type: "auth_url", url: "https://example.com/authorize" });
            interaction.notify({
              type: "device_code",
              userCode: "ABCD-1234",
              verificationUri: "https://example.com/d",
            });
            return { type: "oauth", access: "token", refresh: "refresh", expires: Date.now() + 3_600_000 };
          },
          refresh: async (credential) => credential,
          toAuth: async (credential) => ({ apiKey: credential.access }),
        },
      }),
    );
    const svc = createService();

    expect(
      await svc.handleCommand({ type: "login", loginId: "l1", providerId: "fake-oauth", method: "oauth" }),
    ).toMatchObject({ success: true });

    expect(envelopes.filter((e) => e.kind === "login_event").map((e) => e.payload)).toEqual([
      { type: "auth_url", url: "https://example.com/authorize" },
      { type: "device_code", userCode: "ABCD-1234", verificationUri: "https://example.com/d" },
    ]);
    expect((await provider(svc, "fake-oauth")).status).toMatchObject({ connected: true, type: "oauth", stored: true });
    expect((await provider(svc, "fake-oauth")).methods).toEqual([
      { type: "oauth", label: "Sign in with Fake", isSubscription: true },
    ]);
  });

  // Sign in with ChatGPT refuses to start without this installation's device id.
  it("gives a sign-in this installation's device id", async () => {
    const seen: (string | undefined)[] = [];
    modelRuntime.registerNativeProvider(
      fakeProvider("fake-device", "Fake Device", {
        oauth: {
          name: "Fake Device",
          login: async (_interaction, options) => {
            seen.push(options?.getDeviceId?.());
            return { type: "oauth", access: "token", refresh: "refresh", expires: Date.now() + 3_600_000 };
          },
          refresh: async (credential) => credential,
          toAuth: async (credential) => ({ apiKey: credential.access }),
        },
      }),
    );
    const svc = createService({ getDeviceId: () => "6f1c1a52-4f7e-4d55-9d43-8f3a2c1b9e10" });

    await svc.handleCommand({ type: "login", loginId: "l1", providerId: "fake-device", method: "oauth" });

    expect(seen).toEqual(["6f1c1a52-4f7e-4d55-9d43-8f3a2c1b9e10"]);
  });
});
