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
// `ChatOpenAIFields` so the upstream HTTP request is streamed (no timeout on
// slow reasoning models). We override both `_streamResponseChunks` and
// `_generate` to aggregate the streamed response and recover DSML tool calls
// before the result reaches the agent graph or the UI.
//
// - `_streamResponseChunks` — the primary path. When the agent has a streaming
//   handler, `_generateUncached` calls `_streamResponseChunks` directly,
//   bypassing `_generate`. Our override aggregates all chunks without
//   forwarding per-token callbacks (the run manager is dropped), recovers DSML
//   tool calls from the aggregated content, and yields a single cleaned chunk.
// - `_generate` — the fallback path. Taken when there is no streaming handler
//   (e.g. tool-only calls). `_streamResponseChunks` is called internally by
//   `ChatOpenAI._generate` and our override already handles aggregation and
//   recovery, so the extra `recoverDsmlToolCalls` here is a safe no-op.
//
// We deliberately do NOT set `disableStreaming = true` — the ChatOpenAI
// constructor overrides `this.streaming = false` when that flag is on, which
// would defeat upstream streaming and cause 502 timeouts. Used only for
// DeepSeek models so other models keep their normal token-by-token streaming.

import { ChatGenerationChunk } from "@langchain/core/outputs";
import { concat } from "@langchain/core/utils/stream";
import { ChatOpenAI } from "@langchain/openai";
import { recoverDsmlToolCalls } from "../agent/leaked-tool-calls";

import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export class DsmlAwareChatOpenAI extends ChatOpenAI {
  // `streaming` is set via `ChatOpenAIFields.streaming = true` by the caller
  // (`model-provider.ts`) — a class property would be overridden by the
  // ChatOpenAI constructor (`this.streaming = fields?.streaming ?? false`).

  /**
   * Aggregate all streamed chunks into a single result without forwarding
   * per-token callbacks to the UI. When the agent has a streaming handler,
   * `_generateUncached` calls `_streamResponseChunks` directly — bypassing
   * `_generate`. This override ensures no raw DSML markup leaks and recovers
   * tool calls from the aggregated content.
   *
   * @ignore
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    // Drop the run manager so `ChatOpenAI._streamResponseChunks` does not
    // forward per-token callbacks (raw DSML markup would leak). The upstream
    // HTTP request is still streamed — only the callbacks are suppressed.
    let aggregated: ChatGenerationChunk | undefined;

    for await (const chunk of super._streamResponseChunks(messages, options, undefined)) {
      if (aggregated === undefined) {
        aggregated = chunk;
      } else {
        aggregated = concat(aggregated, chunk);
      }
    }

    if (aggregated === undefined) {
      return; // empty stream — let the caller handle it
    }

    // Recover DSML tool calls from the aggregated content before yielding.
    const recovered = recoverDsmlToolCalls(aggregated.message);
    if (recovered !== aggregated.message) {
      // AIMessage works as a drop-in for BaseMessageChunk when no further
      // concat is needed (we aggregate everything into a single chunk here).
      aggregated = new ChatGenerationChunk({
        message: recovered as unknown as ChatGenerationChunk["message"],
        text: typeof recovered.content === "string" ? recovered.content : aggregated.text,
        generationInfo: aggregated.generationInfo,
      });
    }

    yield aggregated;
  }

  /** @ignore */
  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    // This path is taken when `_generateUncached` does NOT detect a streaming
    // handler (e.g. tool-only calls or when disableStreaming forces the
    // else-branch). `_streamResponseChunks` is called internally by
    // `ChatOpenAI._generate` and our override above already aggregates and
    // recovers DSML, so `recoverDsmlToolCalls` here is a safe no-op when
    // already recovered.
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
