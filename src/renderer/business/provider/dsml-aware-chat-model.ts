// A `ChatOpenAI` subclass for DeepSeek models served through OpenAI-compatible
// endpoints that do not parse the model's native tool calls server-side.
//
// Those endpoints leak DeepSeek's "DSML" tool-call markup into the assistant
// text instead of returning a structured `tool_calls` field. LangChain only
// reads `tool_calls`, so the markup surfaces verbatim in the UI and no tool ever
// runs. This client recovers the tool calls from the markup (see
// `recoverDsmlToolCalls`) so the agent graph executes them normally.
//
// The caller (`model-provider.ts`) passes `streaming: true` in
// `ChatOpenAIFields` — a class property would not survive the parent constructor
// (`this.streaming = fields?.streaming ?? false`). Streaming the upstream HTTP
// request prevents the proxy's `fetch` from timing out while waiting for slow
// reasoning models. The parent `_generate` aggregates the upstream stream
// internally; we drop the run manager so `_streamResponseChunks` skips
// per-token callbacks (no raw DSML markup leaks to the UI token by token).
// The whole tool-call block arrives complete before we recover it.
//
// We deliberately do NOT set `disableStreaming = true` — the ChatOpenAI
// constructor overrides `this.streaming = false` when that flag is on, which
// would defeat upstream streaming and cause 502 timeouts. Used only for DeepSeek
// models so other models keep their normal token-by-token streaming.

import { ChatOpenAI } from "@langchain/openai";
import { recoverDsmlToolCalls } from "../agent/leaked-tool-calls";

import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export class DsmlAwareChatOpenAI extends ChatOpenAI {
  // `streaming` is set via `ChatOpenAIFields.streaming = true` by the caller
  // (`model-provider.ts`) — a class property would be overridden by the
  // ChatOpenAI constructor (`this.streaming = fields?.streaming ?? false`).

  /** @ignore */
  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    // Deliberately drop the run manager: `_streamResponseChunks` skips
    // per-token callbacks when runManager is undefined, so the raw DSML markup
    // is never forwarded to the UI token by token. The upstream response is
    // still streamed (no timeout) and aggregated into a single message that we
    // recover tool calls from.
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
