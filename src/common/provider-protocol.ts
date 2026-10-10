// The IPC protocol between the provider settings in main and the settings
// page. Unlike the chat protocol it is global, not per cluster: main owns pi's
// credentials (`auth.json`) and the settings page only ever sees provider
// status, models and login prompts. Commands go to main through `invoke`; login
// prompts and progress come back as broadcast envelopes, answered with
// `ui_response` like the chat's approvals.

import type { AgentResponse } from "./agent-protocol";

export const PROVIDER_COMMAND_CHANNEL = "provider:command";
export const PROVIDER_ENVELOPE_CHANNEL = "provider:envelope";

export type AuthMethodType = "api_key" | "oauth";

/** One way to connect a provider, as pi's `ProviderAuth` offers it. */
export interface AuthMethod {
  type: AuthMethodType;
  /** e.g. "OpenAI API key" or "Sign in with ChatGPT". */
  label: string;
  /** The sign-in uses a paid subscription such as Claude Pro/Max. */
  isSubscription?: boolean;
}

export interface ProviderStatus {
  connected: boolean;
  /** How the provider is connected. */
  type?: AuthMethodType;
  /**
   * Where the credential comes from: "stored credential" for one saved in
   * `auth.json`, otherwise e.g. an environment variable name such as
   * "OPENAI_API_KEY".
   */
  source?: string;
  /** The credential is saved in `auth.json`, so Log out can remove it. */
  stored: boolean;
}

export interface ProviderSummary {
  id: string;
  name: string;
  /** Methods with an interactive login; empty for providers that only use ambient credentials. */
  methods: AuthMethod[];
  status: ProviderStatus;
  modelCount: number;
}

/** A model of pi's catalog, with what the cards show. */
export interface ProviderModelSummary {
  provider: string;
  /** The provider's display name, e.g. "OpenAI"; the chat picker groups by it. */
  providerName: string;
  id: string;
  name: string;
  contextWindow: number;
  /** USD per million tokens. */
  inputCost: number;
  outputCost: number;
  reasoning: boolean;
}

/** A question pi's login asks; `select` answers with an option id. */
export interface LoginPrompt {
  id: string;
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: { id: string; label: string; description?: string }[];
}

/** Something pi's login tells the user without asking. */
export type LoginEvent =
  | { type: "info"; message: string; links?: { url: string; label?: string }[] }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string };

interface ProviderEnvelopeBase {
  /** The login the envelope belongs to; a newer login replaces an older one. */
  loginId: string;
}

export type ProviderEnvelope =
  | (ProviderEnvelopeBase & { kind: "ui_request"; payload: LoginPrompt })
  /** The prompt no longer needs an answer, e.g. a browser callback arrived before the pasted code. */
  | (ProviderEnvelopeBase & { kind: "ui_resolved"; payload: { id: string } })
  | (ProviderEnvelopeBase & { kind: "login_event"; payload: LoginEvent })
  | (ProviderEnvelopeBase & { kind: "login_end"; payload: { success: boolean; error?: string } })
  /**
   * A login or logout changed the stored credentials, so the connected
   * providers and their models may have changed. Not tied to a login: every
   * window reloads what it shows, e.g. the chat's model picker.
   */
  | { kind: "credentials_changed" };

export type ProviderCommand =
  /** Every pi built-in provider with its status; answers with `ProviderSummary[]`. */
  | { type: "list_providers" }
  /** The models of connected providers; answers with `ProviderModelSummary[]`. */
  | { type: "list_models"; providerId?: string }
  /** Runs pi's login; the response arrives when it ends. A newer login cancels this one. */
  | { type: "login"; loginId: string; providerId: string; method: AuthMethodType }
  /** Cancels the login with this id; a cancel for an older login is ignored. */
  | { type: "cancel_login"; loginId: string }
  /** Answers a login prompt; `cancelled` ends the login without saving anything. */
  | { type: "ui_response"; id: string; value?: string; cancelled?: boolean }
  | { type: "logout"; providerId: string };

export type ProviderResponse = AgentResponse;
