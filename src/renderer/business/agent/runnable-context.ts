// Wires a real `AsyncLocalStorage` into LangChain's run-context singleton so the
// renderer can propagate the active run config the way a Node process would.
//
// LangGraph's `interrupt()` — the human-in-the-loop approval gate for write
// tools (create/update/patch/delete) — reads the active run config *only* from
// `AsyncLocalStorageProviderSingleton.getRunnableConfig()`, which in turn reads
// from a global `AsyncLocalStorage` instance. LangGraph initializes that
// instance from its Node entry (`@langchain/langgraph/dist/index.js`, via
// `node:async_hooks`). The renderer bundle resolves the package's `"browser"`
// export to `dist/web.js`, which never initializes it, so `@langchain/core`
// falls back to a `MockAsyncLocalStorage` whose `getStore()` always returns
// `undefined`. With no store, `interrupt()` throws "Called interrupt() outside
// the context of a graph" instead of suspending the graph, and the write-tool
// approval prompt never reaches the UI (issue #181).
//
// The Freelens renderer is an Electron renderer with Node builtins available
// (the bundler keeps `node:*` external on purpose — see electron.vite.config.js),
// so we can do what LangGraph's Node entry would have done: install a real
// `AsyncLocalStorage`. `initializeGlobalInstance` only accepts the first
// instance, so this is idempotent and safe to call on every activation. This
// restores both the approval gate and implicit run-context propagation.

import { AsyncLocalStorage } from "node:async_hooks";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";

export function ensureRunnableContextStorage(): void {
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
}
