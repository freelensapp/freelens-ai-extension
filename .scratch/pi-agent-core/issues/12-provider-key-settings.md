# Provider and key settings

Type: prototype
Status: claimed
Blocked by:

## Question

How do users pick a provider and model, enter keys and log in, now that pi
owns the provider layer in main?

- Use pi's auth storage and model registry, or keep keys in the extension's
  `PreferencesStore` and pass them to pi.
- How custom OpenAI-compatible models (base URL, headers, model id, reasoning
  flag) are declared, replacing the editable model list and the
  `x-upstream-base-url` proxy routing.
- Environment-variable keys (`OPENAI_API_KEY` today, pi's per-provider env
  vars).
- The settings page layout: a provider picker, per-provider key fields, model
  list from pi's catalog.
- The OAuth/subscription login dialog. It drives `ModelRuntime.login(provider,
  "oauth", interaction)` from the renderer over IPC: it answers `text`,
  `secret`, `select` and `manual_code` prompts, opens `auth_url` with the
  system browser, shows `device_code`, and can cancel. It also needs a logout,
  and to show "logged in" (`isUsingOAuth`). Spike facts:
  [06](06-spike-pi-in-main.md).
- Model pricing and context limits come from pi's model catalog. LiteLLM
  pricing (`model-pricing*.ts`) and `model-capabilities.ts` are deleted.

Prototype the settings UI to react to.

Settled input from [10](10-approvals-over-ipc.md): the settings page also gets
a per-tool "Requires approval" list, which replaces the
`podLogsRequireApproval` toggle. It is not part of this prototype, but the
layout should leave room for it.

## Facts gathered

Checked against the installed `@earendil-works/pi-coding-agent` 1.0.0 by
running `ModelRuntime` under Node with a throwaway `auth.json`.

- **Storage.** `ModelRuntime.create({ authPath, modelsPath })` keeps
  credentials (API keys and OAuth tokens) in pi's `auth.json` and custom
  providers in pi's `models.json`, both at paths we choose
  (`dist/core/model-runtime.d.ts:75`). Both can live in the extension folder in
  main, so keys never reach the renderer. Today `openAIKey` sits in
  `PreferencesStore` (`src/common/store/preferences-store.ts:30`), which the
  host syncs to every renderer.
- **API keys go through `login()` too.** `ModelRuntime.login(provider,
  "api_key" | "oauth", interaction)` (`model-runtime.d.ts:178`) drives both
  kinds through the same `AuthInteraction` callbacks (`pi-ai`
  `dist/auth/types.d.ts:150`, "Login interaction callbacks serving both api-key
  and OAuth flows"). Each provider asks its own questions, as observed:
  - OpenAI, Anthropic, Azure OpenAI: one `secret` prompt.
  - Amazon Bedrock: a `select` (bearer token, AWS profile, credential chain),
    then the matching prompt.
  - Google Vertex AI: a `select` (API key, ADC, service account), then the
    matching prompt.
  - Cloudflare AI Gateway: a `secret` (key), then two `text` prompts (account
    id, gateway id). These go into the stored credential's `env`.

  So one generic login dialog that renders `text`, `secret`, `select`,
  `manual_code`, `auth_url`, `device_code`, `info` and `progress` covers every
  provider, for both API keys and OAuth. No per-provider key fields or
  per-provider forms are needed.
- **Providers.** `getProviders()` lists 43 built-in providers. Every one has an
  API-key method except `openai-codex` (OAuth only). OAuth is offered by
  OpenAI ("Sign in with ChatGPT"), Anthropic (Claude Pro/Max), GitHub Copilot,
  Kimi, Meta, OpenRouter, Radius, xAI and `openai-codex`; all but OpenRouter
  and Radius are marked `isSubscription`.
- **Status.** `checkAuth(providerId)` resolves where a provider's auth comes
  from, e.g. `{ source: "DEEPSEEK_API_KEY", type: "api_key" }` for an env var.
  `getProviderAuthStatus()` is a snapshot that stays `{ configured: false }`
  until the availability refresh runs, so the page should use `checkAuth()` or
  `getAvailable()`. `isUsingOAuth` / `isUsingSubscription` tell sign-ins
  apart. `logout(providerId)` removes the stored credential; it doesn't unset
  env vars.
- **Env vars** are read from main's `process.env`. On macOS a Freelens started
  from the Dock doesn't get the shell's variables, so env keys mostly help
  Linux users and people who start Freelens from a terminal.
- **Models.** Each catalog model carries `name`, `reasoning`,
  `contextWindow`, `maxTokens` and `cost` (USD per million tokens, with
  tiers), e.g. `openai/gpt-5.5`: 272k context, $5 / $30. This feeds the model
  picker, the context gauge and the cost counter. `getAvailable()` returns only
  models of providers with working auth.
- **Custom providers.** `models.json` takes per provider a `baseUrl`, `api`,
  `apiKey` (literal, `$ENV_VAR` or a command), `headers` and `models` (`id`,
  `reasoning`, `contextWindow`, `cost`, `compat`, ...). This replaces the
  editable model list, the base URL field and the `x-upstream-base-url`
  proxy. `registerProvider()` can also add one at runtime without the file.
- **Thinking.** pi's `thinkingLevel` (`off`, `minimal`, `low`, `medium`,
  `high`, `xhigh`) is mapped to each provider by pi, so it replaces both the
  reasoning-effort select and the "Disable thinking mode" switch (`off`).

## Prototype

Throwaway UI prototype on the existing settings page (sub-shape A), on
`piagent`:
[`src/renderer/pages/preferences/prototype-provider-settings.tsx`](../../../src/renderer/pages/preferences/prototype-provider-settings.tsx),
mounted at the top of `PreferencesPage` behind
`SHOW_PROVIDER_SETTINGS_PROTOTYPE`. It's stubbed in memory: no IPC, nothing
saved, and the login flows replay the prompts observed above. A yellow
floating bar (or the left/right arrow keys) switches between:

- **A, Provider table:** every built-in provider in one filterable table with
  its auth methods, status (not connected, API key saved, signed in, from
  `ENV_VAR`) and Connect / Log out. Below it a custom-provider form, then the
  default model and thinking level.
- **B, Connected cards:** only connected providers, as cards listing their
  models with prices; click a model to make it the default. "Add provider"
  opens a searchable picker and then the login dialog; "Add custom endpoint"
  opens the form inline.
- **C, Model first:** one searchable table of every model (provider, context,
  price). "Use" picks an available model; "Connect and use" runs the login
  inline for an unconnected provider. Custom providers via the form or a
  `models.json` view.

All three share the one login dialog, a placeholder for the tool approval list
from ticket 10, and a "State that would be saved" panel that shows what lands
in `auth.json`, `models.json` and `PreferencesStore`.

To try it: `pnpm pack:dev`, install the `.tgz` in Freelens, open
Preferences, Freelens AI Settings.

## Round 1: reactions wanted

- **Q1 - Layout:** A, B, C, or a mix (e.g. "B's cards with C's model
  search")? Recommendation: **B**. Most users connect one or two providers;
  a 43-row table (A) is mostly noise, and the model picker already lives in
  the chat footer, so model-first (C) duplicates it.
- **Q2 - Where credentials live:** pi's `auth.json` and `models.json` in the
  extension folder in main, or our `PreferencesStore`. Recommendation: **pi's
  files** (`<extension folder>/pi/auth.json`, `.../models.json`). pi owns
  refresh and locking, OAuth needs it anyway, and keys stop being synced to
  every renderer.
- **Q3 - Custom providers:** form only (name, base URL, key, model ids,
  reasoning), or form plus a raw `models.json` editor for headers, `api`,
  costs and `compat`. Recommendation: **form for v1**, written into
  `models.json`; power users can edit the file, and the page shows its path.
- **Q4 - Default model:** the settings page sets the default for new chats
  and the chat footer switches per chat (today the footer is the only
  picker), or only the footer. Recommendation: **footer only**, listing
  `getAvailable()` models grouped by provider, remembered as the last used.
  The settings page shows models only inside each provider card.
- **Q5 - Thinking level:** one global setting, or a per-chat control next to
  the model picker (pi supports changing it mid-session). Recommendation:
  **global setting for v1**, default `medium`, clamped by pi per model.
- **Q6 - Upgrading users:** today's `openAIKey` and custom `openAIBaseUrl`.
  Import them once into `auth.json` / `models.json` on first start, or start
  clean. Recommendation: **import once**, then delete the old fields. It's a
  few lines and avoids a "my agent stopped working" moment, unlike chats
  (ticket 03), which aren't worth converting.
- **Q7 - Env-var keys:** show a provider as connected when `checkAuth()`
  finds an env var (status "From `ENV_VAR`", no logout), or ignore env vars.
  Recommendation: **show them**; it's free from pi.
