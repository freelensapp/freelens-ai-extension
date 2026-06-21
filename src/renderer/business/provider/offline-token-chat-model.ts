// A `ChatOpenAI` subclass that counts tokens locally instead of downloading the
// tiktoken BPE ranks from the network.
//
// `@langchain/core`'s `getNumTokens` fetches the encoding from
// `https://tiktoken.pages.dev` on demand. When that host is unreachable the
// fetch fails, retries with exponential backoff, and is never cached, so every
// model turn re-stalls and the chat hangs (issue #181). We override
// `getNumTokens` to use a local approximation — the same heuristic LangChain
// falls back to anyway — keeping token counting offline and instant.

import { ChatOpenAI } from "@langchain/openai";
import { approximateTokenCount } from "./token-estimate";

import type { MessageContent } from "@langchain/core/messages";

export class OfflineTokenChatOpenAI extends ChatOpenAI {
  override async getNumTokens(content: MessageContent): Promise<number> {
    return approximateTokenCount(content);
  }
}
