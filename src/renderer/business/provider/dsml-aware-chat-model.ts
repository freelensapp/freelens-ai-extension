// A `ChatOpenAI` subclass for DeepSeek models served through OpenAI-compatible
// endpoints that do not parse the model's native tool calls server-side.
//
// Those endpoints leak DeepSeek's "DSML" tool-call markup into the assistant
// text instead of returning a structured `tool_calls` field. LangChain only
// reads `tool_calls`, so the markup surfaces verbatim in the UI and no tool ever
// runs. This client recovers the tool calls from the markup (see
// `recoverDsmlToolCalls`) so the agent graph executes them normally.
//
// `disableStreaming = true` routes the agent/langgraph calls through `_generate`
// (instead of token-by-token `_streamResponseChunks`), so the DSML markup is
// never streamed to the UI before we can rewrite it: the whole tool-call block
// must have arrived before it is recoverable.
//
// The *upstream* HTTP request is still streamed (`streaming = true`), because a
// non-streaming request to a slow reasoning endpoint makes the proxy's `fetch`
// wait for the entire completion and time out with a bare "fetch failed" (502).
// `_generate` streams the upstream response and aggregates it into a single
// message; we pass no run manager to the super call so those per-token
// callbacks are not forwarded to the agent's streaming handler (which would
// leak the raw markup token by token). Used only for DeepSeek models, so other
// models keep their normal token-by-token streaming intact.

import { ChatOpenAI } from "@langchain/openai";
import { recoverDsmlToolCalls } from "../agent/leaked-tool-calls";

import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export class DsmlAwareChatOpenAI extends ChatOpenAI {
  // Force the agent-facing `_generate` path (no token-level streaming to the
  // UI); see the file header.
  disableStreaming = true;
  // Keep the upstream request streamed so the proxy `fetch` is not left waiting
  // for a full non-streaming completion (slow reasoning models -> "fetch
  // failed"); see the file header.
  streaming = true;

  /** @ignore */
  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    // Deliberately drop the run manager: `_generate` streams the upstream
    // response internally, and forwarding its per-token callbacks would leak the
    // raw DSML markup to the UI token by token. We aggregate here and hand back
    // a single message with the tool calls recovered.
    const result = await super._generate(messages, options, undefined);

    const generations = result.generations.map((generation) => {
      const message = recoverDsmlToolCalls(generation.message);
      if (message === generation.message) {
        return generation;
      }
      return {
        ...generation,
        message,
        text: typeof message.content === "string" ? message.content : generation.text,
      };
    });

    return { ...result, generations };
  }
}
