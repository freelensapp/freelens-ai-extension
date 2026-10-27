# 11: Model requests go through the Freelens HTTP client

**What to build:** a user behind a corporate HTTPS proxy, or with a company CA,
gets a working chat wherever Freelens itself works, because pi's model
requests use the proxy and CA preferences of Freelens.

- After a session is created, its stream function is wrapped so that every
  model request carries the host's `fetch` (`Main.Util.fetch`), read when the
  request is sent. This covers the chat and compaction, which share the stream
  function, and AI Explain's sessions.
- Requests to the Google Generative AI and Google Vertex APIs keep pi's
  default, because those adapters refuse a custom fetch.
- pi's OAuth logins and model-list refreshes do not go through the stream
  function and stay on Node's `fetch`. These gaps are recorded as a finding in
  the plan record, with a request to pi for a session-level fetch option.
- Nothing replaces the global `fetch` or the global HTTP dispatcher of the main
  process.
- The agent host receives the `fetch` to use as an injected option, so tests
  pass their own.

**Blocked by:** 07 (port, step 5).

**Status:** ready-for-agent

- [x] Agent host test: the injected `fetch` reaches the provider request of a
      chat run (pi's faux provider receives it in the request options).
- [x] Agent host test: the same holds for AI Explain.
- [x] Agent host test: a model on a Google API gets no custom `fetch`.
- [x] The finding about the gaps is in the plan record, with the pi request
      linked once filed.
- [ ] Every check passes; one commit, pushed.
