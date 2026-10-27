# 11: Custom OpenAI-compatible providers and the base URL import

**What to build:** "Add custom endpoint" opens an inline form (name, base URL,
API key, model ids, reasoning on or off) that writes an OpenAI-compatible
provider into pi's `models.json`. The provider then shows as a card and its
models appear in the chat picker. The page shows the path of `models.json` for
hand edits (headers, costs, `compat`). Upgrading users who had a custom
`openAIBaseUrl` get it imported once as such a provider, with their key and
the ids from the old `models` list.

**Blocked by:** 10

**Status:** resolved (HITL check pending)

- [x] Global IPC commands add and remove a custom provider; removing deletes
      it from `models.json` and its key.
- [x] The form validates the base URL and requires at least one model id.
- [x] A chat on a custom model reaches the custom base URL directly, with no
      local proxy in between.
- [x] One-time import: a non-empty `openAIKey` with a custom `openAIBaseUrl`
      becomes a custom provider carrying the key and the old model ids, under
      the same run-once marker as ticket 01. Clearing the old fields is
      ticket 14.
- [x] Agent host tests cover add, remove and the import.
- [ ] HITL: add an OpenAI-compatible endpoint (for example a local Ollama or
      LiteLLM) and chat with it.

## Answer

- `src/common/custom-provider.ts`: the form's input, `validateCustomProvider`
  (name, http or https base URL, at least one model id, id not taken) and
  `parseModelIds`. The form and main use the same checks.
- `src/main/agent/custom-providers.ts`: `addCustomProvider` writes an
  `openai-completions` provider (`name`, `baseUrl`, `models` with `reasoning`)
  into `models.json` and stores the key with pi's own `login("api_key")`, so
  the key is only in `auth.json`. pi only offers a models.json provider with a
  credential, so an endpoint without a key gets `apiKey: "none"`, as pi's docs
  do for Ollama. The provider is reloaded with
  `refresh({ providers: [id], allowNetwork: false })`; if pi cannot load it,
  `models.json` and any saved key are rolled back. `removeCustomProvider`
  deletes the entry and its stored key. A custom endpoint is any `models.json`
  entry with a base URL and models that is not a pi built-in, so hand-written
  endpoints get Remove too; built-in overrides do not.
- Ids already in `models.json` count as taken, even when pi failed to load
  them. A `models.json` with comments (pi accepts them) is never rewritten;
  adding says to edit it by hand.
- Protocol: `add_custom_provider`, `remove_custom_provider`,
  `get_models_path`, and `ProviderSummary.custom: { baseUrl }`. Both changes
  broadcast `credentials_changed`, so open chat pickers reload.
- Settings page: "Add custom endpoint" next to "Add provider"; custom cards
  show `Custom endpoint - <base URL>` and a Remove button instead of Log out;
  the `models.json` path is shown under the cards and in the form.
- Import (`importLegacyCustomProvider`): a custom `openAIBaseUrl` with a key
  becomes a provider named after the URL's host (`llm.example.com`, id
  `llm-example-com`), with the old model list plus `selectedModel`, reasoning
  off. `agentModel` is seeded with it when empty, and the plain-text
  `openAIKey` is cleared once the key is in `auth.json`. A stored URL that can
  never become a provider is logged once and not retried.
- `custom-endpoint.test.ts` runs the agent host against a local HTTP server
  speaking the OpenAI streaming API: the request goes to
  `<base URL>/chat/completions` with `Authorization: Bearer <key>` and no
  `x-upstream-base-url` header.

Deviation: the import has its own marker, `pi/legacy-custom-import-done`,
instead of ticket 01's. Anyone who already ran a `piagent` build has ticket
01's marker, which would have skipped this import for them.

Known gaps:

- Imported endpoints get reasoning off, because the old code sent a reasoning
  effort only for OpenAI's own model ids. It can be switched on per model in
  `models.json`.
- The old LangChain proxy still reads `openAIKey`; once the import clears it,
  that path has no key. Nothing reaches it any more since ticket 13, and
  ticket 14 deletes it.
- A base URL with credentials in it (`https://user:token@host`) is shown on
  the card as typed.
