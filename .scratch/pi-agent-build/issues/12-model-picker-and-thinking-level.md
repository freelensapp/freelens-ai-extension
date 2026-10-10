# 12: The chat model picker and the thinking level

**What to build:** the model picker in the chat lists `getAvailable()` models
from the connected providers, grouped by provider, and remembers the last one
used. The settings page gets one global thinking level (`off`, `minimal`,
`low`, `medium`, `high`, `xhigh`; default `medium`) that pi clamps per model.
It replaces the reasoning-effort select and the "Disable thinking mode"
switch.

**Blocked by:** 10

**Status:** resolved (HITL check pending)

- [x] The picker shows only models of providers with working auth, grouped by
      provider, and updates after a login or logout.
- [x] The chosen model applies from the next prompt (pi's `set_model`) and is
      remembered as the last used across restarts.
- [x] With no connected provider, the chat explains how to connect one and
      links to the settings page.
- [x] The thinking level is a global preference read by main on each prompt.
- [x] Agent host tests cover switching the model between prompts and the
      thinking level reaching the session.
- [ ] HITL: switch between two providers' models in one chat.

## Answer

**Picker.** Each cluster window asks main for `list_models` and groups the
answer by provider name (`src/renderer/business/provider-client/model-picker.ts`,
pure and tested). `ProviderModelSummary` gained `providerName` for the group
labels. The choice is stored in the `agentModel` preference as `provider/id`,
which main reads before every prompt and applies with `session.setModel`.

- The remembered model is kept while it is listed. When none was chosen yet,
  the picker stores the first listed model, so main runs the model it shows.
- A remembered model missing from the list is not replaced: its provider may
  only have failed to list for a moment, and overwriting the preference would
  lose the choice in every window. The picker shows "Choose a model" instead,
  and a prompt gets main's "No credentials for ..." answer.
- The context gauge and the cost estimate use the picked model's context size
  and prices from pi's catalog, so they are right for any provider. The token
  counts behind them are still the old ones until ticket 09.
- The old fallback in main to `openai/<selectedModel>` is gone: `agentModel`
  is the only source.

**Reload after login or logout.** The provider service broadcasts a new
envelope, `{ kind: "credentials_changed" }`, after every login (successful or
not, since pi can save a credential and still fail) and logout. It carries no
`loginId` and no credential. The provider IPC client now starts in every
window, not only the root one, so cluster windows receive it and reload the
list.

**No provider connected.** The input shows "No AI provider is connected." and
a **Connect a provider** button that opens the Freelens AI settings. It
replaces "Configure agent".

**Thinking level.** A new `thinkingLevel` preference
(`src/common/thinking-level.ts`), set by a select under the provider cards.
Main passes it to the session when it is created and calls
`session.setThinkingLevel` before every prompt. That second call matters: pi
keeps the clamped level, so after a prompt on a model without reasoning the
session holds `off`, and switching back to a reasoning model would otherwise
run without thinking. A test reproduced this before the fix.

- **Upgrade:** `thinkingLevel` has no store default, so a missing value means
  the old settings were not imported yet. "Disable thinking mode" on becomes
  `off`; a reasoning effort of `low`, `medium` or `high` is kept; anything
  else becomes `medium`.
- The reasoning-effort select and the "Disable thinking mode" switch are gone
  from the settings page. Their preference fields stay until ticket 14.

**AI Explain until ticket 13.** It still runs on the old OpenAI client:

- It maps the thinking level to its reasoning fields
  (`explainReasoningOptions`). `off` sends the old "Disable thinking mode"
  field it was imported from. This client does not clamp per model the way pi
  does, so `minimal` and `xhigh` become `low` and `high`, which every OpenAI
  reasoning model accepts.
- Picking an OpenAI model in the chat also makes it AI Explain's model. A
  model of another provider leaves AI Explain on its last OpenAI model.

**Tests:** agent host (4, written first, pi's faux provider with a reasoning
and a plain model): switching the model between prompts, the level read
before each prompt reaching the provider, the level surviving a detour
through a model without reasoning, and `off` sending no reasoning. Provider
service (1): `credentials_changed` after login and logout, without the key.
Picker helpers (6), the thinking level import (6) and the AI Explain mapping
(3).

**HITL:** connect two providers, pick a model of each in turn in one chat,
and check the answers come from the chosen model. Log out of one provider in
the settings: its models should leave the picker in the open cluster window.
