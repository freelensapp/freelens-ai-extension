import { Common, Renderer } from "@freelensapp/extensions";
import * as React from "react";
import { onProviderEnvelope, sendProviderCommand } from "../../business/provider-client/provider-client";

import type { SingleValue } from "react-select";

import type {
  AuthMethod,
  LoginEvent,
  LoginPrompt,
  ProviderEnvelope,
  ProviderModelSummary,
  ProviderSummary,
} from "../../../common/provider-protocol";

const { useCallback, useEffect, useRef, useState } = React;

const {
  Component: { Button, Icon, Input, Select, Spinner },
} = Renderer;

type SelectOption<T> = Renderer.Component.SelectOption<T>;

// Matches LOGIN_CANCELLED in main: a cancelled login is not an error to show.
const LOGIN_CANCELLED = "Login cancelled.";
// A card lists this many models until "Show all" is clicked; OpenRouter has hundreds.
const MODELS_SHOWN = 8;

const hint = (text: React.ReactNode) => <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>{text}</div>;

// Only web links are opened; a login never needs anything else.
const openLink = (url: string) => {
  if (/^https?:\/\//i.test(url)) {
    void Common.Util.openExternal(url);
  }
};

const statusLabel = ({ status }: ProviderSummary): string => {
  if (!status.stored) {
    return status.source ? `From ${status.source}` : "Connected";
  }
  return status.type === "oauth" ? "Signed in" : "API key saved";
};

const formatContext = (tokens: number) =>
  tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M` : `${Math.round(tokens / 1000)}k`;

const formatCost = (model: ProviderModelSummary) =>
  model.inputCost === 0 && model.outputCost === 0 ? "no price listed" : `$${model.inputCost} / $${model.outputCost}`;

interface LoginState {
  loginId: string;
  provider: ProviderSummary;
  method: AuthMethod;
  prompt?: LoginPrompt;
  events: LoginEvent[];
}

/** Applies one envelope of main's login to the dialog; envelopes of other logins are ignored. */
const reduceLogin = (state: LoginState, envelope: ProviderEnvelope): LoginState => {
  if (envelope.loginId !== state.loginId) {
    return state;
  }
  switch (envelope.kind) {
    case "ui_request":
      return { ...state, prompt: envelope.payload };
    case "ui_resolved":
      return state.prompt?.id === envelope.payload.id ? { ...state, prompt: undefined } : state;
    case "login_event":
      return { ...state, events: [...state.events, envelope.payload] };
    default:
      return state;
  }
};

const newLoginId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const LoginEventView = ({ event }: { event: LoginEvent }) => {
  switch (event.type) {
    case "auth_url":
      return (
        <div style={{ marginBottom: 8 }}>
          <div>{event.instructions ?? "Finish signing in in your browser."}</div>
          <div style={{ marginTop: 4 }}>
            <Button plain label="Open the sign-in page again" onClick={() => openLink(event.url)} />
          </div>
        </div>
      );
    case "device_code":
      return (
        <div style={{ marginBottom: 8 }}>
          <div>
            Open{" "}
            <a href="#" onClick={() => openLink(event.verificationUri)}>
              {event.verificationUri}
            </a>{" "}
            and enter this code:
          </div>
          <div style={{ fontSize: 24, fontFamily: "monospace", letterSpacing: 4, margin: "4px 0" }}>
            {event.userCode}
          </div>
        </div>
      );
    case "info":
      return (
        <div style={{ marginBottom: 8 }}>
          {event.message}
          {event.links?.map((link) => (
            <div key={link.url}>
              <a href="#" onClick={() => openLink(link.url)}>
                {link.label ?? link.url}
              </a>
            </div>
          ))}
        </div>
      );
    default:
      return <div style={{ marginBottom: 8, opacity: 0.7 }}>{event.message}</div>;
  }
};

const PromptView = ({ prompt, onAnswer }: { prompt: LoginPrompt; onAnswer: (value: string) => void }) => {
  const [value, setValue] = useState("");
  if (prompt.type === "select") {
    return (
      <div>
        <div style={{ marginBottom: 8 }}>{prompt.message}</div>
        {prompt.options?.map((option) => (
          <div key={option.id} style={{ marginBottom: 6 }}>
            <Button plain label={option.label} onClick={() => onAnswer(option.id)} />
            {option.description && <div style={{ fontSize: 12, opacity: 0.7 }}>{option.description}</div>}
          </div>
        ))}
      </div>
    );
  }
  const submit = () => onAnswer(value);
  return (
    <div>
      <div style={{ marginBottom: 8 }}>{prompt.message}</div>
      <Input
        autoFocus
        type={prompt.type === "secret" ? "password" : "text"}
        placeholder={prompt.placeholder}
        value={value}
        onChange={(next: string) => setValue(next)}
        onSubmit={submit}
      />
      <div style={{ marginTop: 8 }}>
        <Button primary label={prompt.type === "manual_code" ? "Submit code" : "Continue"} onClick={submit} />
      </div>
    </div>
  );
};

interface LoginDialogProps {
  provider: ProviderSummary;
  onClose: (connected: boolean) => void;
  /** Called when a login ends, whatever the outcome. */
  onEnded: () => void;
}

/**
 * Connects one provider: picks the login method when there are several, then
 * shows whatever pi's login asks or reports. The answers go to main; nothing
 * typed here is kept in the renderer.
 */
const LoginDialog = ({ provider, onClose, onEnded }: LoginDialogProps) => {
  const [login, setLogin] = useState<LoginState | undefined>();
  const [error, setError] = useState<string | undefined>();
  const running = useRef<string | undefined>(undefined);
  const openedUrls = useRef(new Set<string>());

  useEffect(
    () =>
      onProviderEnvelope((envelope) => {
        if (envelope.kind === "login_event" && envelope.payload.type === "auth_url") {
          // Open the sign-in page once by itself; the dialog offers to open it again.
          const url = envelope.payload.url;
          if (envelope.loginId === running.current && !openedUrls.current.has(url)) {
            openedUrls.current.add(url);
            openLink(url);
          }
        }
        setLogin((state) => (state ? reduceLogin(state, envelope) : state));
      }),
    [],
  );

  // Closing the settings page mid-login ends it, so main does not wait for answers.
  useEffect(
    () => () => {
      if (running.current) void sendProviderCommand({ type: "cancel_login" });
    },
    [],
  );

  const start = useCallback(
    async (method: AuthMethod) => {
      const loginId = newLoginId();
      running.current = loginId;
      setError(undefined);
      setLogin({ loginId, provider, method, events: [] });
      const response = await sendProviderCommand({
        type: "login",
        loginId,
        providerId: provider.id,
        method: method.type,
      });
      // Even a failed or cancelled login may have saved a credential.
      onEnded();
      if (running.current !== loginId) {
        return;
      }
      running.current = undefined;
      if (response.success) {
        onClose(true);
        return;
      }
      setLogin(undefined);
      if (response.error !== LOGIN_CANCELLED) {
        setError(response.error);
      }
    },
    [provider, onClose, onEnded],
  );

  // One method: start right away, once.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || provider.methods.length !== 1) return;
    autoStarted.current = true;
    void start(provider.methods[0]!);
  }, [provider, start]);

  const answer = (value: string) => {
    if (!login?.prompt) return;
    const id = login.prompt.id;
    setLogin({ ...login, prompt: undefined });
    void sendProviderCommand({ type: "ui_response", id, value });
  };

  const cancel = () => {
    if (running.current) {
      running.current = undefined;
      void sendProviderCommand({ type: "cancel_login" });
    }
    onClose(false);
  };

  let body: React.ReactNode;
  if (!login) {
    body = (
      <>
        <div style={{ marginBottom: 8 }}>How do you want to connect {provider.name}?</div>
        {provider.methods.map((method) => (
          <div key={method.type} style={{ marginBottom: 6 }}>
            <Button
              primary={method.type === "oauth"}
              label={method.isSubscription ? `${method.label} (subscription)` : method.label}
              onClick={() => void start(method)}
            />
          </div>
        ))}
      </>
    );
  } else {
    body = (
      <>
        {login.events.map((event, index) => (
          <LoginEventView key={index} event={event} />
        ))}
        {login.prompt ? (
          <PromptView key={login.prompt.id} prompt={login.prompt} onAnswer={answer} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.7 }}>
            <Spinner /> Waiting for {provider.name}...
          </div>
        )}
      </>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--borderColor, #444)",
        borderRadius: 6,
        padding: 16,
        margin: "8px 0 12px",
        maxWidth: 520,
      }}
    >
      <div style={{ fontWeight: "bold", fontSize: 15, marginBottom: 12 }}>
        Connect {provider.name}
        {login ? ` - ${login.method.label}` : ""}
      </div>
      {body}
      {error && <div style={{ marginTop: 8, color: "var(--colorError, #ce3933)" }}>{error}</div>}
      <div style={{ marginTop: 12, textAlign: "right" }}>
        <Button plain label={login ? "Cancel login" : "Cancel"} onClick={cancel} />
      </div>
    </div>
  );
};

const ProviderCard = ({
  provider,
  models,
  onLogout,
}: {
  provider: ProviderSummary;
  models: ProviderModelSummary[];
  onLogout: () => void;
}) => {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? models : models.slice(0, MODELS_SHOWN);
  return (
    <div style={{ border: "1px solid var(--borderColor, #444)", borderRadius: 6, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontWeight: "bold" }}>{provider.name}</span>
        {provider.status.stored && <Icon material="logout" small interactive tooltip="Log out" onClick={onLogout} />}
      </div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>{statusLabel(provider)}</div>
      {models.length === 0 && hint("No models listed.")}
      {shown.map((model) => (
        <div
          key={model.id}
          title={model.id}
          style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.name}</span>
          <span style={{ fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" }}>
            {formatContext(model.contextWindow)} - {formatCost(model)}
          </span>
        </div>
      ))}
      {models.length > MODELS_SHOWN && (
        <Button
          plain
          label={showAll ? "Show fewer" : `Show all ${models.length} models`}
          onClick={() => setShowAll(!showAll)}
        />
      )}
    </div>
  );
};

/**
 * The connected providers as cards, plus "Add provider" with pi's generic
 * login. Everything comes from main over IPC; credentials never reach here.
 */
export const ProviderSettings = () => {
  const [providers, setProviders] = useState<ProviderSummary[] | undefined>();
  const [models, setModels] = useState<ProviderModelSummary[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [picking, setPicking] = useState(false);
  const [connecting, setConnecting] = useState<ProviderSummary | undefined>();
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const reload = useCallback(async () => {
    const [providerResponse, modelResponse] = await Promise.all([
      sendProviderCommand({ type: "list_providers" }),
      sendProviderCommand({ type: "list_models" }),
    ]);
    if (!mounted.current) return;
    if (!providerResponse.success) {
      setError(providerResponse.error);
      return;
    }
    setError(modelResponse.success ? undefined : modelResponse.error);
    setProviders(providerResponse.data as ProviderSummary[]);
    setModels(modelResponse.success ? (modelResponse.data as ProviderModelSummary[]) : []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const logout = async (provider: ProviderSummary) => {
    const response = await sendProviderCommand({ type: "logout", providerId: provider.id });
    if (!response.success) setError(response.error);
    await reload();
  };

  // The cards reload when a login ends (onLoginEnded), so closing only hides the dialog.
  const onLoginClosed = useCallback(() => setConnecting(undefined), []);
  const onLoginEnded = useCallback(() => void reload(), [reload]);

  const connected = providers?.filter((provider) => provider.status.connected) ?? [];
  const connectable = (providers ?? [])
    .filter((provider) => provider.methods.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  const pickerOptions: SelectOption<string>[] = connectable.map((provider) => ({
    value: provider.id,
    label: provider.status.connected ? `${provider.name} (connected)` : provider.name,
  }));

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: "bold", fontSize: 16 }}>Providers</div>
        <Button primary label="Add provider" disabled={!providers} onClick={() => setPicking(!picking)} />
      </div>
      {hint(
        "The chat runs on the models of these providers. Keys and sign-ins are stored by the extension, never in the preferences. Providers whose key is set in an environment variable show up here by themselves.",
      )}
      {picking && (
        <div style={{ marginBottom: 12, maxWidth: 520 }}>
          <Select
            autoFocus
            menuIsOpen
            placeholder={`Search ${connectable.length} providers...`}
            options={pickerOptions}
            onChange={(option: SingleValue<SelectOption<string>>) => {
              setPicking(false);
              setConnecting(connectable.find((provider) => provider.id === option?.value));
            }}
            themeName="lens"
          />
        </div>
      )}
      {connecting && (
        <LoginDialog key={connecting.id} provider={connecting} onClose={onLoginClosed} onEnded={onLoginEnded} />
      )}
      {error && <div style={{ marginBottom: 8, color: "var(--colorError, #ce3933)" }}>{error}</div>}
      {!providers && !error && <Spinner />}
      {providers && connected.length === 0 && hint("No provider is connected yet. Use Add provider to connect one.")}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {connected.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            models={models.filter((model) => model.provider === provider.id)}
            onLogout={() => void logout(provider)}
          />
        ))}
      </div>
    </>
  );
};
