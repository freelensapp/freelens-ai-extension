# Providers in the first version

Type: grilling
Status: resolved
Blocked by:

## Question

Ship with every pi built-in provider plus custom OpenAI-compatible ones, or keep
OpenAI and custom first and add multi-provider later?

## Answer

Every pi built-in provider plus custom OpenAI-compatible ones (option a).
Resolved by leo-capvano in PR #290, grilling round 1. OAuth/subscription logins
are deferred (Out of scope on the map). How keys and models are configured is
[Provider and key settings](12-provider-key-settings.md).
