# 11: Custom OpenAI-compatible providers and the base URL import

**What to build:** "Add custom endpoint" opens an inline form (name, base URL,
API key, model ids, reasoning on or off) that writes an OpenAI-compatible
provider into pi's `models.json`. The provider then shows as a card and its
models appear in the chat picker. The page shows the path of `models.json` for
hand edits (headers, costs, `compat`). Upgrading users who had a custom
`openAIBaseUrl` get it imported once as such a provider, with their key and
the ids from the old `models` list.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] Global IPC commands add and remove a custom provider; removing deletes
      it from `models.json` and its key.
- [ ] The form validates the base URL and requires at least one model id.
- [ ] A chat on a custom model reaches the custom base URL directly, with no
      local proxy in between.
- [ ] One-time import: a non-empty `openAIKey` with a custom `openAIBaseUrl`
      becomes a custom provider carrying the key and the old model ids, under
      the same run-once marker as ticket 01. Clearing the old fields is
      ticket 14.
- [ ] Agent host tests cover add, remove and the import.
- [ ] HITL: add an OpenAI-compatible endpoint (for example a local Ollama or
      LiteLLM) and chat with it.
