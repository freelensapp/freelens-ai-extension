# 01: pi 1.4.0 on the current toolchain

**What to build:** the pi chat keeps working exactly as today, on pi 1.4.0
instead of 1.0.0, still on the v1 toolchain, so that a breakage from pi shows
up alone and not mixed into the port.

pi changed in ways that touch the extension (read pi's changelog from 1.0.0 to
1.4.0 for the full list):

- `before_agent_start` is now a union on its message type and also fires for a
  custom message that starts a run. The handler that sets the cluster and user
  rules sections must handle both types.
- The Azure provider is renamed from `azure-openai-responses` to `azure`. A
  user who connected Azure keeps the old key in pi's credentials file, and a
  saved last used model may name the old provider.
- pi requires Node 22.19 or later.

**Blocked by:** None (can start immediately).

**Status:** resolved (HITL check pending: manual-test-cases.md)

- [x] Every pi package the extension depends on is at 1.4.0, and the lockfile
      holds no older pi.
- [x] An agent host test proves that the cluster and user rules sections reach
      the prompt on pi 1.4.0, for a run started by a user message.
- [x] The Azure rename is handled: a credential or saved model under the old
      provider id either still works or fails with a clear message that tells
      the user to sign in again; a test covers what the extension does.
- [x] Any other breaking change in the changelog that touches the extension is
      handled or noted in the plan record as not applicable.
- [x] Type check, Biome, unit tests and the build pass on the current
      toolchain, and pi still bundles into the main output.
- [x] One commit.
