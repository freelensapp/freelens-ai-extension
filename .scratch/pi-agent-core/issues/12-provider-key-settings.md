# Provider and key settings

Type: prototype
Status: open
Blocked by: 06

## Question

How do users pick a provider and model and enter keys, now that pi owns the
provider layer in main?

- Use pi's auth storage and model registry, or keep keys in the extension's
  `PreferencesStore` and pass them to pi.
- How custom OpenAI-compatible models (base URL, headers, model id, reasoning
  flag) are declared, replacing the editable model list and the
  `x-upstream-base-url` proxy routing.
- Environment-variable keys (`OPENAI_API_KEY` today, pi's per-provider env
  vars).
- The settings page layout: a provider picker, per-provider key fields, model
  list from pi's catalog.

Prototype the settings UI to react to.
