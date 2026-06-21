// A `ChatOpenAI` subclass that counts tokens locally instead of downloading the
// tiktoken BPE ranks from the network.
//
// `@langchain/core`'s `getNumTokens` fetches the encoding from
// `https://tiktoken.pages.dev` on demand. When that host is unreachable the
// fetch fails, retries with exponential backoff, and is never cached, so every
// model turn re-stalls and the chat hangs (issue #181). We replace
// `getNumTokens` with a local approximation — the same heuristic LangChain
// falls back to anyway — keeping token counting offline and instant.
//
// Patching only `ChatOpenAI.prototype` (or a subclass) is NOT enough. In
// `@langchain/openai` v1, the exported `ChatOpenAI` is a thin facade: its
// constructor creates two internal worker instances —
// `this.completions = new ChatOpenAICompletions(...)` and
// `this.responses = new ChatOpenAIResponses(...)` — and `_generate` delegates
// to one of them (`return this.completions._generate(...)`). The token counting
// (`_getNumTokensFromGenerations` -> `getNumTokens`) therefore runs on that
// inner worker instance, which is a `ChatOpenAICompletions`, not our facade
// subclass, so it never inherits the facade-level override and falls through to
// core's network-fetching `getNumTokens`. This is exactly the path in the
// issue #181 stack trace (`completions.js` -> core `base.js`).
//
// So we patch `getNumTokens` on `BaseLanguageModel.prototype` — the single core
// class where the method is defined and which every model variant (the facade,
// its inner completions/responses workers, and any other chat model) inherits
// from. The patch runs when this module is imported, which the model-provider
// does before any model is created, so no instance can reach the tiktoken
// download.

import { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatOpenAI } from "@langchain/openai";
import { approximateTokenCount } from "./token-estimate";

import type { MessageContent } from "@langchain/core/messages";

// Patch the core base prototype once, as a module side effect. Every chat model
// instance — the `ChatOpenAI` facade, the `ChatOpenAICompletions` /
// `ChatOpenAIResponses` workers it delegates to, and our subclasses — resolves
// `getNumTokens` through this, so none can reach the tiktoken download.
BaseLanguageModel.prototype.getNumTokens = function getNumTokens(content: MessageContent): Promise<number> {
  return Promise.resolve(approximateTokenCount(content));
};

export class OfflineTokenChatOpenAI extends ChatOpenAI {
  override async getNumTokens(content: MessageContent): Promise<number> {
    return approximateTokenCount(content);
  }
}
