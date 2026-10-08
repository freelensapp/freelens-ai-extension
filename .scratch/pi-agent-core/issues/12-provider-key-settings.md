# Provider and key settings

Type: prototype
Status: open
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
