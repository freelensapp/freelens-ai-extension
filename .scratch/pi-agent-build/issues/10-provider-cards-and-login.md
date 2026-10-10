# 10: Provider cards and the generic login dialog

**What to build:** the settings page shows the user's connected providers as
cards (models, context sizes, prices, status, Log out). "Add provider" opens a
searchable picker of pi's built-in providers, then one login dialog that
renders whatever pi's `login()` asks, for API keys and subscription sign-ins
alike: `text`, `secret`, `select`, `manual_code`, `auth_url` (opened in the
system browser), `device_code`, `info` and `progress`. A login can be
cancelled. Providers whose key comes from an environment variable show as
connected, "From `ENV_VAR`", without Log out. Credentials stay in main.

**Blocked by:** 01

**Status:** resolved (HITL check pending)

- [x] Global IPC commands: list providers with status (`checkAuth()`), list
      available models, start a login, cancel a login, log out.
- [x] Login prompts go out as `ui_request` envelopes that the settings page
      consumes, and answers come back as `ui_response`; cancelling ends the
      login without saving anything.
- [x] API keys and OAuth tokens are written only to `auth.json` in main and
      never appear in the preferences or in any envelope.
- [x] The cards replace today's OpenAI key field and editable model list on
      the settings page.
- [x] Agent host tests with a fake model runtime cover a secret prompt, a
      select then secret flow, a cancel, logout, and an env-var provider
      without logout.
- [ ] HITL: connect OpenAI with a key, connect one subscription provider
      (for example GitHub Copilot or Claude Pro/Max) through the browser, log
      out of one, and see the cards update.

## Answer

- **Protocol** (`src/common/provider-protocol.ts`): its own pair of channels,
  `provider:command` and `provider:envelope`, because it is global rather than
  per cluster. Commands: `list_providers`, `list_models`, `login` (answers
  when the login ends), `cancel_login` (names its `loginId`; a cancel for an
  older login is ignored), `ui_response` (`value` or `cancelled`) and
  `logout`. Envelopes carry a `loginId`: `ui_request` (a prompt),
  `ui_resolved` (pi dropped a prompt, e.g. a pasted code once the browser
  callback arrived), `login_event` (pi's `notify` events) and `login_end`.
  Only display fields are copied into envelopes; answers go to main through
  `invoke` and are never broadcast.
- **Main** (`src/main/agent/provider-service.ts`): wraps `ModelRuntime`.
  One login runs at a time; a new one cancels the previous. Cancelling a
  prompt cancels the whole login, as in pi. Logout of a provider that only has
  an environment variable is refused with "uses `ENV_VAR`". Models are read
  with `getAvailable(providerId)` per provider, because the all-provider
  snapshot is refreshed in the background and misses a key that just
  appeared. Every login gets a stable device id from
  `<extension folder>/pi/device-id`: pi's "Sign in with ChatGPT" throws
  without one.
- **Settings page** (`provider-settings.tsx`): connected providers as cards
  with status ("API key saved", "Signed in", "From `ENV_VAR`"), Log out for
  stored credentials only, and up to 8 models with "Show all". "Add provider"
  is a searchable select of providers with a login method, then the dialog.
  The dialog picks a method when there are two, opens an `auth_url` in the
  system browser once (http and https only) and offers to open it again. The
  cards reload whenever a login ends, since pi can save a credential and still
  report an error. Closing the dialog or the page cancels the login.
- **Renderer IPC** (`provider-client.ts`): only the root window starts it,
  because the settings page lives there.
- **Bridges until later tickets:**
  - The chat input no longer checks for an OpenAI key in the renderer
    (`chat-readiness.ts`); main refuses a prompt without credentials and says
    which provider to connect. AI Explain without any key now gets the
    upstream's 401 instead of the earlier "register the API key" message.
  - AI Explain still runs on the local proxy. With the default Base URL the
    proxy uses `OPENAI_API_KEY`, else pi's OpenAI API key (not a ChatGPT
    sign-in token), so Log out on the OpenAI card logs AI Explain out too. A
    custom Base URL keeps its own key, whose field stays on the page, under
    "AI Explain", only while a custom Base URL is set. Ticket 13 moves AI
    Explain to pi.
  - Once pi holds an OpenAI credential and the Base URL is the default, main
    clears the old plain-text `openAIKey` from the preferences on start.
  - The old chat picker still lists the old OpenAI model names, so a
    connected non-OpenAI provider shows a card but can't be chosen in the
    chat until ticket 12.
  - The Base URL, reasoning effort and "disable thinking" fields stay for AI
    Explain until tickets 11 to 13.
- **Tests:** 13 tests in `provider-service.test.ts` on a real `ModelRuntime`
  with a temporary `auth.json` and fake providers registered with
  `registerNativeProvider`: listing pi's providers and login methods, a secret
  prompt (the key is in `auth.json` and in no envelope), select then secret,
  cancel, cancel by the prompt, a newer login replacing an older one, a cancel
  for an older login, an answer for an unknown prompt, logout, an env-var
  provider without logout, models of connected providers, `login_event`
  forwarding, and the device id.
