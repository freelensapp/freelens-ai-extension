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
// A subclass override alone is not enough: `_generate` (and the structured
// output / `bindTools` wrappers) call `this.getNumTokens` on whatever
// `ChatOpenAI` instance LangChain/LangGraph actually drives, and that is not
// always our subclass. So we also patch `ChatOpenAI.prototype.getNumTokens`
// at module load. The patch runs when this module is imported, which the
// model-provider does before any model is created, so every `ChatOpenAI`
// instance — ours or one created internally by LangChain — counts tokens
// locally and never touches the network.

import { ChatOpenAI } from "@langchain/openai";
import { approximateTokenCount } from "./token-estimate";

import type { MessageContent } from "@langchain/core/messages";

// Patch the base prototype once, as a module side effect. Every `ChatOpenAI`
// instance (including ones LangChain/LangGraph create that are not our
// subclass) resolves `getNumTokens` through this, so none can reach the
// tiktoken download.
ChatOpenAI.prototype.getNumTokens = function getNumTokens(content: MessageContent): Promise<number> {
  return Promise.resolve(approximateTokenCount(content));
};

export class OfflineTokenChatOpenAI extends ChatOpenAI {
  override async getNumTokens(content: MessageContent): Promise<number> {
    return approximateTokenCount(content);
  }
}
