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

**Status:** ready-for-agent

- [ ] Global IPC commands: list providers with status (`checkAuth()`), list
      available models, start a login, cancel a login, log out.
- [ ] Login prompts go out as `ui_request` envelopes that the settings page
      consumes, and answers come back as `ui_response`; cancelling ends the
      login without saving anything.
- [ ] API keys and OAuth tokens are written only to `auth.json` in main and
      never appear in the preferences or in any envelope.
- [ ] The cards replace today's OpenAI key field and editable model list on
      the settings page.
- [ ] Agent host tests with a fake model runtime cover a secret prompt, a
      select then secret flow, a cancel, logout, and an env-var provider
      without logout.
- [ ] HITL: connect OpenAI with a key, connect one subscription provider
      (for example GitHub Copilot or Claude Pro/Max) through the browser, log
      out of one, and see the cards update.
