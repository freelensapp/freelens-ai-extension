/**
 * PROTOTYPE, throwaway (pi agent core map, ticket 12: provider, key and login
 * settings). Three structurally different layouts for the provider section of
 * the settings page, switchable with the floating bar at the bottom or the
 * left/right arrow keys. Everything is stubbed in memory: no IPC, nothing is
 * written to disk, and the login flows are scripted copies of what pi 1.0.0
 * asks (probed with `ModelRuntime.login`). Delete once the ticket is resolved.
 */

import { Renderer } from "@freelensapp/extensions";
import * as React from "react";

import type { SingleValue } from "react-select";

const { useEffect, useState } = React;

const {
  Component: { Button, Icon, Input, Select, HorizontalLine },
} = Renderer;

type SelectOption<T> = Renderer.Component.SelectOption<T>;

// Set to false to hide the prototype without removing it.
export const SHOW_PROVIDER_SETTINGS_PROTOTYPE = true;

type AuthKind = "api_key" | "oauth";

// Mirrors pi's AuthStatus/checkAuth sources.
type ProviderAuth =
  | { configured: false }
  | { configured: true; source: "stored"; kind: AuthKind; subscription?: boolean }
  | { configured: true; source: "environment"; envVar: string };

interface StubModel {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  // USD per million tokens, as in pi's catalog.
  cost: { input: number; output: number };
}

interface StubProvider {
  id: string;
  name: string;
  apiKeyName?: string;
  envVar?: string;
  oauth?: { name: string; subscription: boolean };
  models: StubModel[];
  custom?: { baseUrl: string; headers: Record<string, string> };
}

// A subset of pi's 43 built-in providers, with names and auth methods as
// reported by `ModelRuntime.getProviders()` in 1.0.0.
const BUILTIN_PROVIDERS: StubProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    apiKeyName: "OpenAI API key",
    envVar: "OPENAI_API_KEY",
    oauth: { name: "Sign in with ChatGPT", subscription: true },
    models: [
      { id: "gpt-5.5", name: "GPT-5.5", reasoning: true, contextWindow: 272000, cost: { input: 5, output: 30 } },
      { id: "gpt-5.4", name: "GPT-5.4", reasoning: true, contextWindow: 272000, cost: { input: 2.5, output: 15 } },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 mini",
        reasoning: true,
        contextWindow: 272000,
        cost: { input: 0.4, output: 2 },
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    apiKeyName: "Anthropic API key",
    envVar: "ANTHROPIC_API_KEY",
    oauth: { name: "Anthropic (Claude Pro/Max)", subscription: true },
    models: [
      {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        reasoning: true,
        contextWindow: 200000,
        cost: { input: 5, output: 25 },
      },
      {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        reasoning: true,
        contextWindow: 200000,
        cost: { input: 3, output: 15 },
      },
    ],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    apiKeyName: "GitHub Copilot token",
    oauth: { name: "GitHub Copilot", subscription: true },
    models: [{ id: "gpt-5.4", name: "GPT-5.4", reasoning: true, contextWindow: 128000, cost: { input: 0, output: 0 } }],
  },
  {
    id: "google",
    name: "Google",
    apiKeyName: "Gemini API key",
    envVar: "GEMINI_API_KEY",
    models: [
      {
        id: "gemini-3-pro",
        name: "Gemini 3 Pro",
        reasoning: true,
        contextWindow: 1000000,
        cost: { input: 2, output: 12 },
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    apiKeyName: "DeepSeek API key",
    envVar: "DEEPSEEK_API_KEY",
    models: [
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        reasoning: true,
        contextWindow: 128000,
        cost: { input: 0.5, output: 2 },
      },
      {
        id: "deepseek-flash",
        name: "DeepSeek Flash",
        reasoning: false,
        contextWindow: 128000,
        cost: { input: 0.1, output: 0.4 },
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    apiKeyName: "OpenRouter API key",
    envVar: "OPENROUTER_API_KEY",
    oauth: { name: "Sign in with OpenRouter", subscription: false },
    models: [
      {
        id: "anthropic/claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        reasoning: true,
        contextWindow: 200000,
        cost: { input: 3, output: 15 },
      },
    ],
  },
  {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    apiKeyName: "AWS credentials or bearer token",
    models: [
      {
        id: "anthropic.claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        reasoning: true,
        contextWindow: 200000,
        cost: { input: 3, output: 15 },
      },
    ],
  },
  {
    id: "cloudflare-ai-gateway",
    name: "Cloudflare AI Gateway",
    apiKeyName: "Cloudflare API key",
    envVar: "CLOUDFLARE_API_KEY",
    models: [
      { id: "openai/gpt-5.5", name: "GPT-5.5", reasoning: true, contextWindow: 272000, cost: { input: 5, output: 30 } },
    ],
  },
];

const INITIAL_AUTH: Record<string, ProviderAuth> = {
  openai: { configured: true, source: "stored", kind: "api_key" },
  deepseek: { configured: true, source: "environment", envVar: "DEEPSEEK_API_KEY" },
};

const THINKING_LEVELS: SelectOption<string>[] = ["off", "minimal", "low", "medium", "high", "xhigh"].map((level) => ({
  value: level,
  label: level,
}));

// ---------------------------------------------------------------------------
// Scripted login flows (what main would relay from pi over IPC)

type LoginStep =
  | { type: "secret" | "text" | "manual_code"; message: string; placeholder?: string }
  | { type: "select"; message: string; options: { id: string; label: string }[] }
  | { type: "auth_url"; url: string; instructions: string }
  | { type: "device_code"; userCode: string; verificationUri: string }
  | { type: "progress"; message: string };

function scriptFor(provider: StubProvider, kind: AuthKind): LoginStep[] {
  if (kind === "api_key") {
    if (provider.id === "amazon-bedrock") {
      return [
        {
          type: "select",
          message: "Select Amazon Bedrock authentication method:",
          options: [
            { id: "bearer-token", label: "Bearer token" },
            { id: "aws-profile", label: "AWS profile" },
            { id: "credential-chain", label: "AWS credential chain" },
          ],
        },
        { type: "secret", message: "Enter Amazon Bedrock bearer token" },
      ];
    }
    if (provider.id === "cloudflare-ai-gateway") {
      return [
        { type: "secret", message: "Enter Cloudflare API key" },
        { type: "text", message: "Enter Cloudflare account ID" },
        { type: "text", message: "Enter Cloudflare AI Gateway ID" },
      ];
    }
    return [{ type: "secret", message: `Enter ${provider.apiKeyName ?? provider.name}` }];
  }
  if (provider.id === "github-copilot") {
    return [
      { type: "device_code", userCode: "8F2C-41DA", verificationUri: "https://github.com/login/device" },
      { type: "progress", message: "Waiting for GitHub to confirm the code..." },
    ];
  }
  return [
    {
      type: "auth_url",
      url: `https://auth.example.invalid/${provider.id}/authorize`,
      instructions: "Your browser opens the sign-in page. Freelens continues when the sign-in completes.",
    },
    {
      type: "manual_code",
      message: "If the browser could not reach Freelens, paste the redirect URL or code here",
      placeholder: "https://localhost/callback?code=...",
    },
  ];
}

interface LoginDialogProps {
  provider: StubProvider;
  kind?: AuthKind;
  inline?: boolean;
  onDone: (auth: ProviderAuth) => void;
  onCancel: () => void;
}

const LoginDialog = ({ provider, kind: fixedKind, inline, onDone, onCancel }: LoginDialogProps) => {
  const methods: AuthKind[] = [
    ...(provider.oauth ? (["oauth"] as AuthKind[]) : []),
    ...(provider.apiKeyName ? (["api_key"] as AuthKind[]) : []),
  ];
  const [kind, setKind] = useState<AuthKind | undefined>(fixedKind ?? (methods.length === 1 ? methods[0] : undefined));
  const [stepIndex, setStepIndex] = useState(0);
  const [value, setValue] = useState("");

  const steps = kind ? scriptFor(provider, kind) : [];
  const step = steps[stepIndex];

  const next = () => {
    setValue("");
    if (stepIndex + 1 >= steps.length) {
      onDone({
        configured: true,
        source: "stored",
        kind: kind ?? "api_key",
        subscription: kind === "oauth" && provider.oauth?.subscription,
      });
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  let body: React.ReactNode;
  if (!kind) {
    body = (
      <>
        <div style={{ marginBottom: 8 }}>How do you want to connect {provider.name}?</div>
        {methods.map((method) => (
          <div key={method} style={{ marginBottom: 6 }}>
            <Button
              primary={method === "oauth"}
              label={method === "oauth" ? provider.oauth?.name : `Use an API key (${provider.apiKeyName})`}
              onClick={() => setKind(method)}
            />
          </div>
        ))}
      </>
    );
  } else if (step.type === "select") {
    body = (
      <>
        <div style={{ marginBottom: 8 }}>{step.message}</div>
        {step.options.map((option) => (
          <div key={option.id} style={{ marginBottom: 6 }}>
            <Button plain label={option.label} onClick={next} />
          </div>
        ))}
      </>
    );
  } else if (step.type === "auth_url") {
    body = (
      <>
        <div style={{ marginBottom: 8 }}>{step.instructions}</div>
        <code style={{ display: "block", marginBottom: 8, opacity: 0.7 }}>{step.url}</code>
        <Button primary label="Open browser (stub: continue)" onClick={next} />
      </>
    );
  } else if (step.type === "device_code") {
    body = (
      <>
        <div style={{ marginBottom: 8 }}>
          Open <code>{step.verificationUri}</code> and enter this code:
        </div>
        <div style={{ fontSize: 24, fontFamily: "monospace", letterSpacing: 4, marginBottom: 8 }}>{step.userCode}</div>
        <Button primary label="Open browser (stub: continue)" onClick={next} />
      </>
    );
  } else if (step.type === "progress") {
    body = (
      <>
        <div style={{ marginBottom: 8 }}>{step.message}</div>
        <Button primary label="(stub) Simulate success" onClick={next} />
      </>
    );
  } else {
    body = (
      <>
        <div style={{ marginBottom: 8 }}>{step.message}</div>
        <Input
          type={step.type === "secret" ? "password" : "text"}
          placeholder={step.placeholder}
          value={value}
          onChange={(v: string) => setValue(v)}
          onSubmit={next}
        />
        <div style={{ marginTop: 8 }}>
          <Button primary label={step.type === "manual_code" ? "Submit code" : "Continue"} onClick={next} />
        </div>
      </>
    );
  }

  const card = (
    <div
      style={{
        background: "var(--mainBackground, #1e2124)",
        border: "1px solid var(--borderColor, #444)",
        borderRadius: 6,
        padding: 16,
        minWidth: 420,
      }}
    >
      <div style={{ fontWeight: "bold", fontSize: 15, marginBottom: 12 }}>
        Connect {provider.name}
        {kind ? ` - ${kind === "oauth" ? "sign in" : "API key"}` : ""}
      </div>
      {body}
      <div style={{ marginTop: 12, textAlign: "right" }}>
        <Button plain label="Cancel" onClick={onCancel} />
      </div>
    </div>
  );

  if (inline) return <div style={{ margin: "8px 0" }}>{card}</div>;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      {card}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shared prototype state

interface ProtoState {
  providers: StubProvider[];
  auth: Record<string, ProviderAuth>;
  selected: string; // "<provider>/<model>"
  thinking: string;
}

interface VariantProps {
  state: ProtoState;
  setAuth: (providerId: string, auth: ProviderAuth) => void;
  logout: (providerId: string) => void;
  select: (key: string) => void;
  setThinking: (level: string) => void;
  addCustom: (provider: StubProvider) => void;
  removeCustom: (providerId: string) => void;
}

const authLabel = (auth: ProviderAuth | undefined): string => {
  if (!auth?.configured) return "Not connected";
  if (auth.source === "environment") return `From ${auth.envVar}`;
  if (auth.kind === "oauth") return auth.subscription ? "Signed in (subscription)" : "Signed in";
  return "API key saved";
};

const isAvailable = (state: ProtoState, provider: StubProvider) =>
  !!provider.custom || state.auth[provider.id]?.configured === true;

const availableModelOptions = (state: ProtoState): SelectOption<string>[] =>
  state.providers
    .filter((provider) => isAvailable(state, provider))
    .flatMap((provider) =>
      provider.models.map((model) => ({
        value: `${provider.id}/${model.id}`,
        label: `${provider.name} - ${model.name}`,
      })),
    );

const formatCost = (model: StubModel) =>
  model.cost.input === 0 && model.cost.output === 0
    ? "included"
    : `$${model.cost.input} / $${model.cost.output} per 1M`;

const sectionTitle = (text: string) => <div style={{ fontWeight: "bold", fontSize: 16, marginBottom: 4 }}>{text}</div>;
const hint = (text: React.ReactNode) => <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.7 }}>{text}</div>;

const DefaultModelAndThinking = ({ state, select, setThinking }: VariantProps) => (
  <div style={{ display: "flex", gap: 16 }}>
    <div style={{ flex: 2 }}>
      <div style={{ fontWeight: "bold" }}>Default model</div>
      {hint("Only models of connected providers. The chat footer can still switch per chat.")}
      <Select
        options={availableModelOptions(state)}
        value={state.selected}
        onChange={(option: SingleValue<SelectOption<string>>) => option && select(option.value)}
        themeName="lens"
      />
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: "bold" }}>Thinking level</div>
      {hint("pi's thinkingLevel. Replaces reasoning effort and 'Disable thinking'.")}
      <Select
        options={THINKING_LEVELS}
        value={state.thinking}
        onChange={(option: SingleValue<SelectOption<string>>) => option && setThinking(option.value)}
        themeName="lens"
      />
    </div>
  </div>
);

const CustomProviderForm = ({ addCustom, onClose }: { addCustom: (p: StubProvider) => void; onClose?: () => void }) => {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState("");
  const [reasoning, setReasoning] = useState(false);
  const save = () => {
    if (!name.trim() || !baseUrl.trim()) return;
    const id = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    addCustom({
      id,
      name: name.trim(),
      custom: { baseUrl: baseUrl.trim(), headers: apiKey ? { Authorization: "Bearer ********" } : {} },
      models: models
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
        .map((m) => ({ id: m, name: m, reasoning, contextWindow: 128000, cost: { input: 0, output: 0 } })),
    });
    setName("");
    setBaseUrl("");
    setApiKey("");
    setModels("");
    onClose?.();
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 6, alignItems: "center" }}>
      <span>Name</span>
      <Input placeholder="e.g. LiteLLM" value={name} onChange={(v: string) => setName(v)} />
      <span>Base URL</span>
      <Input placeholder="https://litellm.internal/v1" value={baseUrl} onChange={(v: string) => setBaseUrl(v)} />
      <span>API key</span>
      <Input type="password" placeholder="optional" value={apiKey} onChange={(v: string) => setApiKey(v)} />
      <span>Model ids</span>
      <Input
        placeholder="comma separated, e.g. qwen3-coder, llama-4"
        value={models}
        onChange={(v: string) => setModels(v)}
      />
      <span>Reasoning</span>
      <label>
        <input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} /> models accept a
        thinking level
      </label>
      <span />
      <div style={{ display: "flex", gap: 8 }}>
        <Button primary label="Add custom provider" onClick={save} />
        {onClose && <Button plain label="Cancel" onClick={onClose} />}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Variant A: every provider in one table, status and action per row

const VariantA = (props: VariantProps) => {
  const { state, setAuth, logout, removeCustom, addCustom } = props;
  const [connecting, setConnecting] = useState<StubProvider | undefined>();
  const [filter, setFilter] = useState("");
  const builtins = state.providers.filter((p) => !p.custom && p.name.toLowerCase().includes(filter.toLowerCase()));
  const customs = state.providers.filter((p) => p.custom);
  return (
    <>
      {sectionTitle("Providers")}
      {hint("All of pi's built-in providers. Connect with an API key or sign in; credentials are kept by pi in main.")}
      <Input placeholder="Filter providers" value={filter} onChange={(v: string) => setFilter(v)} />
      <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse" }}>
        <tbody>
          {builtins.map((provider) => {
            const auth = state.auth[provider.id];
            return (
              <tr key={provider.id} style={{ borderBottom: "1px solid var(--borderColor, #333)" }}>
                <td style={{ padding: 6 }}>{provider.name}</td>
                <td style={{ padding: 6, opacity: 0.7, fontSize: 12 }}>
                  {[
                    provider.apiKeyName && "API key",
                    provider.oauth && (provider.oauth.subscription ? "subscription" : "sign in"),
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </td>
                <td style={{ padding: 6, color: auth?.configured ? "var(--colorSuccess, #4caf50)" : undefined }}>
                  {authLabel(auth)}
                </td>
                <td style={{ padding: 6, textAlign: "right" }}>
                  {auth?.configured && auth.source === "stored" ? (
                    <Button
                      plain
                      label={auth.kind === "oauth" ? "Log out" : "Remove key"}
                      onClick={() => logout(provider.id)}
                    />
                  ) : (
                    <Button primary label="Connect" onClick={() => setConnecting(provider)} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {connecting && (
        <LoginDialog
          provider={connecting}
          onDone={(auth) => {
            setAuth(connecting.id, auth);
            setConnecting(undefined);
          }}
          onCancel={() => setConnecting(undefined)}
        />
      )}

      <HorizontalLine />
      {sectionTitle("Custom OpenAI-compatible providers")}
      {hint("Written to pi's models.json. Replaces the base URL field and the local AI proxy.")}
      {customs.map((provider) => (
        <div key={provider.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <span style={{ minWidth: 120 }}>{provider.name}</span>
          <code style={{ flex: 1, opacity: 0.7 }}>{provider.custom?.baseUrl}</code>
          <span style={{ opacity: 0.7 }}>{provider.models.map((m) => m.id).join(", ")}</span>
          <Icon material="delete" small interactive tooltip="Remove" onClick={() => removeCustom(provider.id)} />
        </div>
      ))}
      <CustomProviderForm addCustom={addCustom} />

      <HorizontalLine />
      {sectionTitle("Model")}
      <DefaultModelAndThinking {...props} />
    </>
  );
};

// ---------------------------------------------------------------------------
// Variant B: only connected providers as cards, "Add provider" picker

const VariantB = (props: VariantProps) => {
  const { state, setAuth, logout, removeCustom, addCustom, select } = props;
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<StubProvider | undefined>();
  const [addingCustom, setAddingCustom] = useState(false);
  const connected = state.providers.filter((p) => isAvailable(state, p));
  const unconnected = state.providers.filter((p) => !p.custom && !isAvailable(state, p));
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {sectionTitle("Your providers")}
        <div style={{ display: "flex", gap: 8 }}>
          <Button primary label="Add provider" onClick={() => setAdding(true)} />
          <Button plain label="Add custom endpoint" onClick={() => setAddingCustom(true)} />
        </div>
      </div>
      {hint("Pick a model by clicking it. The star marks the default for new chats.")}
      {adding && (
        <div style={{ marginBottom: 12 }}>
          <Select
            placeholder="Search 43 providers..."
            options={unconnected.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(option: SingleValue<SelectOption<string>>) => {
              setPicked(state.providers.find((p) => p.id === option?.value));
              setAdding(false);
            }}
            themeName="lens"
          />
        </div>
      )}
      {addingCustom && (
        <div style={{ border: "1px dashed var(--borderColor, #555)", borderRadius: 6, padding: 12, marginBottom: 12 }}>
          <CustomProviderForm addCustom={addCustom} onClose={() => setAddingCustom(false)} />
        </div>
      )}
      {picked && (
        <LoginDialog
          provider={picked}
          onDone={(auth) => {
            setAuth(picked.id, auth);
            setPicked(undefined);
          }}
          onCancel={() => setPicked(undefined)}
        />
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {connected.map((provider) => {
          const auth = state.auth[provider.id];
          return (
            <div
              key={provider.id}
              style={{ border: "1px solid var(--borderColor, #444)", borderRadius: 6, padding: 12 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontWeight: "bold" }}>{provider.name}</span>
                {provider.custom ? (
                  <Icon
                    material="delete"
                    small
                    interactive
                    tooltip="Remove"
                    onClick={() => removeCustom(provider.id)}
                  />
                ) : auth?.configured && auth.source === "stored" ? (
                  <Icon material="logout" small interactive tooltip="Disconnect" onClick={() => logout(provider.id)} />
                ) : null}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
                {provider.custom ? `Custom: ${provider.custom.baseUrl}` : authLabel(auth)}
              </div>
              {provider.models.map((model) => {
                const key = `${provider.id}/${model.id}`;
                return (
                  <div
                    key={key}
                    onClick={() => select(key)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "2px 4px",
                      cursor: "pointer",
                      borderRadius: 4,
                      background: state.selected === key ? "var(--blue, #3d90ce)" : undefined,
                    }}
                  >
                    <span>
                      {state.selected === key ? "* " : ""}
                      {model.name}
                    </span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>{formatCost(model)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <HorizontalLine />
      <div style={{ maxWidth: 260 }}>
        <div style={{ fontWeight: "bold" }}>Thinking level</div>
        <Select
          options={THINKING_LEVELS}
          value={state.thinking}
          onChange={(option: SingleValue<SelectOption<string>>) => option && props.setThinking(option.value)}
          themeName="lens"
        />
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Variant C: model first; connecting happens inline when a model needs it

const VariantC = (props: VariantProps) => {
  const { state, setAuth, addCustom } = props;
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<{ provider: StubProvider; key: string } | undefined>();
  const [json, setJson] = useState(false);
  const rows = state.providers.flatMap((provider) =>
    provider.models
      .filter((m) => `${provider.name} ${m.name} ${m.id}`.toLowerCase().includes(query.toLowerCase()))
      .map((model) => ({ provider, model, key: `${provider.id}/${model.id}` })),
  );
  return (
    <>
      {sectionTitle("Model")}
      {hint("Search every model pi knows. Picking one from a provider you have not connected asks you to connect it.")}
      <Input
        placeholder="Search models, e.g. sonnet, gpt-5, deepseek"
        value={query}
        onChange={(v: string) => setQuery(v)}
      />
      {pending && (
        <LoginDialog
          inline
          provider={pending.provider}
          onDone={(auth) => {
            setAuth(pending.provider.id, auth);
            props.select(pending.key);
            setPending(undefined);
          }}
          onCancel={() => setPending(undefined)}
        />
      )}
      <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.7 }}>
            <th style={{ padding: 4 }}>Model</th>
            <th style={{ padding: 4 }}>Provider</th>
            <th style={{ padding: 4 }}>Context</th>
            <th style={{ padding: 4 }}>Price (in / out)</th>
            <th style={{ padding: 4 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ provider, model, key }) => {
            const available = isAvailable(state, provider);
            return (
              <tr
                key={key}
                style={{
                  borderBottom: "1px solid var(--borderColor, #333)",
                  background: state.selected === key ? "rgba(61,144,206,0.25)" : undefined,
                }}
              >
                <td style={{ padding: 4 }}>{model.name}</td>
                <td style={{ padding: 4 }}>
                  {provider.name}
                  <div style={{ fontSize: 11, opacity: 0.6 }}>
                    {provider.custom ? "custom" : authLabel(state.auth[provider.id])}
                  </div>
                </td>
                <td style={{ padding: 4 }}>{Math.round(model.contextWindow / 1000)}k</td>
                <td style={{ padding: 4 }}>{formatCost(model)}</td>
                <td style={{ padding: 4, textAlign: "right" }}>
                  {state.selected === key ? (
                    <span>Selected</span>
                  ) : available ? (
                    <Button plain label="Use" onClick={() => props.select(key)} />
                  ) : (
                    <Button primary label="Connect and use" onClick={() => setPending({ provider, key })} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ maxWidth: 260, marginTop: 8 }}>
        <div style={{ fontWeight: "bold" }}>Thinking level</div>
        <Select
          options={THINKING_LEVELS}
          value={state.thinking}
          onChange={(option: SingleValue<SelectOption<string>>) => option && props.setThinking(option.value)}
          themeName="lens"
        />
      </div>
      <HorizontalLine />
      {sectionTitle("Advanced: custom providers")}
      {hint(
        <>
          Edit pi&apos;s <code>models.json</code> directly (any API pi supports, headers, costs), or use the form.
        </>,
      )}
      <Button plain label={json ? "Show form" : "Edit models.json"} onClick={() => setJson(!json)} />
      <div style={{ marginTop: 8 }}>
        {json ? (
          <textarea
            readOnly
            style={{
              width: "100%",
              minHeight: 160,
              fontFamily: "monospace",
              fontSize: 12,
              background: "#222",
              color: "#fff",
            }}
            value={JSON.stringify(
              {
                providers: Object.fromEntries(
                  state.providers
                    .filter((p) => p.custom)
                    .map((p) => [
                      p.id,
                      {
                        baseUrl: p.custom?.baseUrl,
                        api: "openai-completions",
                        models: p.models.map((m) => ({ id: m.id, reasoning: m.reasoning })),
                      },
                    ]),
                ),
              },
              null,
              2,
            )}
          />
        ) : (
          <CustomProviderForm addCustom={addCustom} />
        )}
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Switcher and host

const VARIANTS = [
  { key: "A", name: "Provider table", Component: VariantA },
  { key: "B", name: "Connected cards", Component: VariantB },
  { key: "C", name: "Model first", Component: VariantC },
];

const PrototypeSwitcher = ({ index, setIndex }: { index: number; setIndex: (i: number) => void }) => {
  const step = (delta: number) => setIndex((index + delta + VARIANTS.length) % VARIANTS.length);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, [contenteditable]") || target.isContentEditable)) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const variant = VARIANTS[index];
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#ffd400",
        color: "#000",
        borderRadius: 999,
        padding: "6px 14px",
        display: "flex",
        gap: 12,
        alignItems: "center",
        boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
        zIndex: 999,
        fontWeight: "bold",
      }}
    >
      <span style={{ cursor: "pointer" }} onClick={() => step(-1)}>
        {"<"}
      </span>
      <span>
        PROTOTYPE {variant.key} ({variant.name})
      </span>
      <span style={{ cursor: "pointer" }} onClick={() => step(1)}>
        {">"}
      </span>
    </div>
  );
};

export const ProviderSettingsPrototype = () => {
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<ProtoState>({
    providers: BUILTIN_PROVIDERS,
    auth: INITIAL_AUTH,
    selected: "openai/gpt-5.5",
    thinking: "medium",
  });

  const props: VariantProps = {
    state,
    setAuth: (providerId, auth) => setState((s) => ({ ...s, auth: { ...s.auth, [providerId]: auth } })),
    logout: (providerId) =>
      setState((s) => {
        const auth = { ...s.auth };
        delete auth[providerId];
        return { ...s, auth };
      }),
    select: (key) => setState((s) => ({ ...s, selected: key })),
    setThinking: (level) => setState((s) => ({ ...s, thinking: level })),
    addCustom: (provider) =>
      setState((s) => ({ ...s, providers: [...s.providers.filter((p) => p.id !== provider.id), provider] })),
    removeCustom: (providerId) =>
      setState((s) => ({ ...s, providers: s.providers.filter((p) => p.id !== providerId) })),
  };

  const { Component } = VARIANTS[index];

  // What main would persist: pi's auth.json (credentials, never sent to the
  // renderer), pi's models.json (custom providers) and our PreferencesStore.
  const persisted = {
    "auth.json (main only, values redacted)": Object.fromEntries(
      Object.entries(state.auth)
        .filter(([, auth]) => auth.configured && auth.source === "stored")
        .map(([id, auth]) => [
          id,
          { type: auth.configured && auth.source === "stored" ? auth.kind : "", key: "********" },
        ]),
    ),
    "models.json": {
      providers: Object.fromEntries(
        state.providers
          .filter((p) => p.custom)
          .map((p) => [p.id, { baseUrl: p.custom?.baseUrl, models: p.models.map((m) => m.id) }]),
      ),
    },
    PreferencesStore: { defaultModel: state.selected, thinkingLevel: state.thinking },
  };

  return (
    <div style={{ border: "2px dashed #ffd400", borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <div style={{ color: "#ffd400", fontWeight: "bold", marginBottom: 8 }}>
        PROTOTYPE (pi agent core, ticket 12) - stubbed, nothing is saved. Use the yellow bar or the arrow keys to switch
        layouts.
      </div>
      <Component {...props} />
      <HorizontalLine />
      {sectionTitle("Tool approvals")}
      {hint("Placeholder: the per-tool 'Requires approval' list from ticket 10 goes here in every variant.")}
      <details>
        <summary style={{ cursor: "pointer", opacity: 0.8 }}>State that would be saved</summary>
        <pre style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify(persisted, null, 2)}</pre>
      </details>
      <PrototypeSwitcher index={index} setIndex={setIndex} />
    </div>
  );
};
