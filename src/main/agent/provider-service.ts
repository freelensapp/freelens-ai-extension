import { randomUUID } from "node:crypto";

import type { AuthEvent, AuthPrompt, Provider } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

import type {
  AuthMethod,
  AuthMethodType,
  LoginEvent,
  LoginPrompt,
  ProviderCommand,
  ProviderEnvelope,
  ProviderModelSummary,
  ProviderResponse,
  ProviderStatus,
  ProviderSummary,
} from "../../common/provider-protocol";

export const LOGIN_CANCELLED = "Login cancelled.";

export interface ProviderServiceOptions {
  modelRuntime: ModelRuntime;
  broadcast: (envelope: ProviderEnvelope) => void;
  /** Called after a login or logout changed the stored credentials. */
  onCredentialsChanged?: () => void;
  /**
   * A UUID that stays the same for this installation. Sign in with ChatGPT
   * refuses to start without it.
   */
  getDeviceId?: () => string;
}

interface ActiveLogin {
  loginId: string;
  controller: AbortController;
}

interface PendingPrompt {
  loginId: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

const ok = (command: string, data?: unknown): ProviderResponse => ({ type: "response", command, success: true, data });
const fail = (command: string, error: string): ProviderResponse => ({
  type: "response",
  command,
  success: false,
  error,
});
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const authMethods = (provider: Provider): AuthMethod[] => {
  const methods: AuthMethod[] = [];
  const { apiKey, oauth } = provider.auth;
  // An API-key method without login only reads ambient credentials (env vars, profiles).
  if (apiKey?.login) {
    methods.push({ type: "api_key", label: apiKey.name });
  }
  if (oauth) {
    methods.push({
      type: "oauth",
      label: oauth.loginLabel ?? oauth.name,
      ...(oauth.isSubscription ? { isSubscription: true } : {}),
    });
  }
  return methods;
};

// Only the fields the page renders, so no auth or headers of a provider reach the renderer.
const toPrompt = (id: string, prompt: AuthPrompt): LoginPrompt => ({
  id,
  type: prompt.type,
  message: prompt.message,
  ...("placeholder" in prompt && prompt.placeholder !== undefined ? { placeholder: prompt.placeholder } : {}),
  ...(prompt.type === "select"
    ? {
        options: prompt.options.map((option) => ({
          id: option.id,
          label: option.label,
          ...(option.description !== undefined ? { description: option.description } : {}),
        })),
      }
    : {}),
});

const toLoginEvent = (event: AuthEvent): LoginEvent => {
  switch (event.type) {
    case "info":
      return {
        type: "info",
        message: event.message,
        ...(event.links ? { links: event.links.map((link) => ({ url: link.url, label: link.label })) } : {}),
      };
    case "auth_url":
      return {
        type: "auth_url",
        url: event.url,
        ...(event.instructions !== undefined ? { instructions: event.instructions } : {}),
      };
    case "device_code":
      return {
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds !== undefined ? { intervalSeconds: event.intervalSeconds } : {}),
        ...(event.expiresInSeconds !== undefined ? { expiresInSeconds: event.expiresInSeconds } : {}),
      };
    default:
      return { type: "progress", message: event.message };
  }
};

/**
 * The provider settings in main: lists pi's providers with their status and
 * models, and drives pi's `login()` for API keys and sign-ins alike. Each
 * question pi asks goes out as a `ui_request` envelope and comes back as a
 * `ui_response` command. Credentials go only into pi's `auth.json`; nothing
 * this sends contains them. One login runs at a time.
 */
export class ProviderService {
  private login?: ActiveLogin;
  private readonly pendingPrompts = new Map<string, PendingPrompt>();

  constructor(private readonly options: ProviderServiceOptions) {}

  async handleCommand(command: ProviderCommand): Promise<ProviderResponse> {
    try {
      switch (command.type) {
        case "list_providers":
          return ok(command.type, await this.listProviders());
        case "list_models":
          return ok(command.type, await this.listModels(command.providerId));
        case "login":
          return await this.runLogin(command.loginId, command.providerId, command.method);
        case "cancel_login":
          this.cancelLogin();
          return ok(command.type);
        case "ui_response":
          return this.answerPrompt(command.id, command.value, command.cancelled === true);
        case "logout":
          return await this.logout(command.providerId);
        default:
          return fail((command as { type?: string }).type ?? "unknown", "Unknown command");
      }
    } catch (error) {
      return fail(command.type, errorText(error));
    }
  }

  dispose(): void {
    this.cancelLogin();
  }

  private async status(provider: Provider, storedIds: ReadonlySet<string>): Promise<ProviderStatus> {
    const stored = storedIds.has(provider.id);
    const check = await this.options.modelRuntime.checkAuth(provider.id).catch(() => undefined);
    if (!check) {
      return { connected: false, stored };
    }
    return { connected: true, type: check.type, ...(check.source ? { source: check.source } : {}), stored };
  }

  private async storedIds(): Promise<Set<string>> {
    const credentials = await this.options.modelRuntime.listCredentials();
    return new Set(credentials.map((credential) => credential.providerId));
  }

  private async listProviders(): Promise<ProviderSummary[]> {
    const { modelRuntime } = this.options;
    const storedIds = await this.storedIds();
    return Promise.all(
      modelRuntime.getProviders().map(async (provider) => ({
        id: provider.id,
        name: provider.name,
        methods: authMethods(provider),
        status: await this.status(provider, storedIds),
        modelCount: modelRuntime.getModels(provider.id).length,
      })),
    );
  }

  private async listModels(providerId?: string): Promise<ProviderModelSummary[]> {
    const { modelRuntime } = this.options;
    // pi's all-provider availability is a snapshot refreshed in the background,
    // so a key that just appeared would be missing; asking per provider checks now.
    const providerIds = providerId ? [providerId] : modelRuntime.getProviders().map((provider) => provider.id);
    const perProvider = await Promise.all(
      providerIds.map((id) =>
        modelRuntime.getAvailable(id).catch(() => [] as Awaited<ReturnType<ModelRuntime["getAvailable"]>>),
      ),
    );
    return perProvider.flat().map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      inputCost: model.cost?.input ?? 0,
      outputCost: model.cost?.output ?? 0,
      reasoning: model.reasoning === true,
    }));
  }

  private async runLogin(loginId: string, providerId: string, method: AuthMethodType): Promise<ProviderResponse> {
    const { modelRuntime, broadcast } = this.options;
    const provider = modelRuntime.getProvider(providerId);
    if (!provider) {
      return fail("login", `Unknown provider ${providerId}.`);
    }
    if (!authMethods(provider).some((m) => m.type === method)) {
      return fail("login", `${provider.name} has no ${method === "oauth" ? "sign-in" : "API key login"}.`);
    }

    // The page that started an older login is gone or moved on.
    this.cancelLogin();
    const controller = new AbortController();
    const login: ActiveLogin = { loginId, controller };
    this.login = login;

    const prompt = (authPrompt: AuthPrompt): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new Error(LOGIN_CANCELLED));
          return;
        }
        const id = randomUUID();
        const settle = () => {
          this.pendingPrompts.delete(id);
          authPrompt.signal?.removeEventListener("abort", onPromptAbort);
        };
        // pi drops a prompt it no longer needs, e.g. a pasted code once the browser callback arrived.
        const onPromptAbort = () => {
          settle();
          broadcast({ loginId, kind: "ui_resolved", payload: { id } });
          reject(new Error("The prompt is no longer needed."));
        };
        this.pendingPrompts.set(id, {
          loginId,
          resolve: (value) => {
            settle();
            resolve(value);
          },
          reject: (error) => {
            settle();
            reject(error);
          },
        });
        authPrompt.signal?.addEventListener("abort", onPromptAbort, { once: true });
        broadcast({ loginId, kind: "ui_request", payload: toPrompt(id, authPrompt) });
      });
    const notify = (event: AuthEvent) => broadcast({ loginId, kind: "login_event", payload: toLoginEvent(event) });

    let response: ProviderResponse;
    try {
      await modelRuntime.login(
        providerId,
        method,
        { signal: controller.signal, prompt, notify },
        this.options.getDeviceId ? { getDeviceId: this.options.getDeviceId } : undefined,
      );
      response = ok("login");
    } catch (error) {
      response = fail("login", controller.signal.aborted ? LOGIN_CANCELLED : errorText(error));
    } finally {
      if (this.login === login) {
        this.login = undefined;
      }
      this.rejectPrompts(loginId);
    }
    // pi may have saved the credential before a late cancel or a failed refresh
    // afterwards, so the stored credentials can have changed either way.
    this.options.onCredentialsChanged?.();
    broadcast({
      loginId,
      kind: "login_end",
      payload: response.success ? { success: true } : { success: false, error: response.error },
    });
    return response;
  }

  private cancelLogin(): void {
    const login = this.login;
    if (!login) {
      return;
    }
    this.login = undefined;
    login.controller.abort();
    this.rejectPrompts(login.loginId);
  }

  private rejectPrompts(loginId: string): void {
    for (const pending of [...this.pendingPrompts.values()]) {
      if (pending.loginId === loginId) {
        pending.reject(new Error(LOGIN_CANCELLED));
      }
    }
  }

  private answerPrompt(id: string, value: string | undefined, cancelled: boolean): ProviderResponse {
    const pending = this.pendingPrompts.get(id);
    if (!pending) {
      return fail("ui_response", "The login is not waiting on this prompt.");
    }
    if (cancelled) {
      // Cancelling a question ends the whole login, as in pi's own dialogs.
      this.cancelLogin();
      return ok("ui_response");
    }
    pending.resolve(value ?? "");
    return ok("ui_response");
  }

  private async logout(providerId: string): Promise<ProviderResponse> {
    const { modelRuntime } = this.options;
    const provider = modelRuntime.getProvider(providerId);
    if (!provider) {
      return fail("logout", `Unknown provider ${providerId}.`);
    }
    if (!(await this.storedIds()).has(providerId)) {
      const check = await modelRuntime.checkAuth(providerId).catch(() => undefined);
      return fail(
        "logout",
        check?.source
          ? `${provider.name} uses ${check.source}. Remove the environment variable to disconnect it.`
          : `${provider.name} has no saved credential.`,
      );
    }
    await modelRuntime.logout(providerId);
    this.options.onCredentialsChanged?.();
    return ok("logout");
  }
}
