# Providers in the first version

Type: grilling
Status: resolved
Blocked by:

## Question

Ship with every pi built-in provider plus custom OpenAI-compatible ones, or keep
OpenAI and custom first and add multi-provider later?

## Answer

Every pi built-in provider plus custom OpenAI-compatible ones (option a).
Resolved by leo-capvano in PR #290, grilling round 1.

Revised in PR #290 after the spike: OAuth and subscription logins are **in**
the first version, because pi ships the flows, token storage and refresh. The
spike ([06](06-spike-pi-in-main.md)) found what the host still has to do:

- call `registerBunOAuthFlows()` at startup, so the flows load from our bundle
- give `ModelRuntime.login()` an `AuthInteraction` UI that can answer
  `text`, `secret`, `select` and `manual_code` prompts, and can show
  `auth_url`, `device_code`, `info` and `progress` events

Whether each provider's terms allow its subscription login in a third-party
app is for the user to check; pi does not check this. How keys, logins and
models are configured is
[Provider and key settings](12-provider-key-settings.md).
