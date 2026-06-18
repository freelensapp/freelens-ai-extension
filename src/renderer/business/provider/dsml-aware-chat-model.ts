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

// The raw OpenAI response envelope `__includeRawResponse` attaches to a
// converted message. Streaming carries the per-token fields under
// `choices[0].delta`; a non-streamed response carries them under
// `choices[0].message`.
type RawResponseChoice = {
  delta?: { reasoning_content?: unknown; reasoning?: unknown };
  message?: { reasoning_content?: unknown; reasoning?: unknown };
};
type RawResponse = { choices?: RawResponseChoice[] };

/**
 * Pull the DeepSeek-style `reasoning_content` out of the raw OpenAI response
 * envelope that `__includeRawResponse` attaches to a converted message.
 *
 * `@langchain/openai` discards `reasoning_content` while converting both
 * streamed deltas (`_convertOpenAIDeltaToBaseMessageChunk`) and non-streamed
 * messages (`_convertOpenAIChatCompletionMessageToBaseMessage`) — it is a
 * DeepSeek extension, not part of the OpenAI schema — so the chain-of-thought
 * only survives on the raw response. Returns an empty string when none is
 * present.
 */
export const extractReasoningFromRawResponse = (kwargs: Record<string, unknown> | undefined): string => {
  const raw = kwargs?.__raw_response as RawResponse | undefined;
  const choice = raw?.choices?.[0];
  const source = choice?.delta ?? choice?.message;
  if (!source) {
    return "";
  }
  const reasoning = source.reasoning_content ?? source.reasoning;
  return typeof reasoning === "string" ? reasoning : "";
};

/**
 * Remove the `__raw_response` envelope from a message's `additional_kwargs`
 * after its reasoning has been read. Streamed chunks are concatenated with
 * `concat`, which would otherwise try to merge the per-delta raw objects
 * (duplicated ids, mismatched numbers) and fail.
 */
const deleteRawResponse = (message: { additional_kwargs?: Record<string, unknown> }): void => {
  if (message.additional_kwargs && "__raw_response" in message.additional_kwargs) {
    delete message.additional_kwargs.__raw_response;
  }
};

export class DsmlAwareChatOpenAI extends ChatOpenAI {
  // `streaming` is set via `ChatOpenAIFields.streaming = true` by the caller
  // (`model-provider.ts`) — a class property would be overridden by the
  // ChatOpenAI constructor (`this.streaming = fields?.streaming ?? false`).

  constructor(fields?: ConstructorParameters<typeof ChatOpenAI>[0]) {
    // Ask the OpenAI client to attach the raw response to every message.
    // `@langchain/openai` drops the model's `reasoning_content`, so reading it
    // back off the raw response (see `extractReasoningFromRawResponse`) is the
    // only way to recover the reasoning the UI renders in its collapsible block.
    super({ ...fields, __includeRawResponse: true });
  }

  /**
   * Aggregate all streamed chunks into a single result without forwarding raw
   * per-token callbacks to the UI, then forward only the final cleaned chunk to
   * the run manager. When the agent has a streaming handler, `_generateUncached`
   * calls `_streamResponseChunks` directly — bypassing `_generate`. This
   * override ensures no raw DSML markup leaks and recovers tool calls from the
   * aggregated content.
   *
   * @ignore
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    // Drop the run manager so `ChatOpenAI._streamResponseChunks` does not
    // forward per-token callbacks (raw DSML markup would leak). The upstream
    // HTTP request is still streamed — only the callbacks are suppressed.
    let aggregated: ChatGenerationChunk | undefined;
    let reasoning = "";

    for await (const chunk of super._streamResponseChunks(messages, options, undefined)) {
      // Capture the reasoning delta before `@langchain/openai` discards it, then
      // strip the raw envelope so `concat` can merge the chunks cleanly.
      reasoning += extractReasoningFromRawResponse(chunk.message.additional_kwargs);
      deleteRawResponse(chunk.message);

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

    // Re-attach the reasoning we salvaged from the raw deltas as
    // `additional_kwargs.reasoning_content`, where the streaming consumer
    // (`extractReasoningText`) already looks for it. Done after recovery so the
    // value survives onto whichever message is finally yielded.
    if (reasoning.length > 0) {
      aggregated.message.additional_kwargs = {
        ...aggregated.message.additional_kwargs,
        reasoning_content: reasoning,
      };
    }

    // Forward the single cleaned chunk to the run manager before yielding.
    //
    // Suppressing per-token callbacks above (the run manager was dropped from
    // the `super` call) means LangGraph's
    // `StreamMessagesHandler.handleLLMNewToken` never fires, so it never marks
    // this run as "emitted". For a run tagged `nostream` (the supervisor) it
    // then has no stored metadata, and its `handleLLMEnd` tries to emit the
    // final message with `undefined` metadata, crashing with "Cannot read
    // properties of undefined (reading '0')". Sending the final chunk here marks
    // the run as emitted and forwards only the recovered text (never the raw
    // per-token markup we suppressed).
    await runManager?.handleLLMNewToken(
      aggregated.text ?? "",
      { prompt: 0, completion: 0 },
      undefined,
      undefined,
      undefined,
      { chunk: aggregated },
    );

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
      // Salvage the reasoning the converter dropped, then strip the raw envelope.
      const reasoning = extractReasoningFromRawResponse(generation.message.additional_kwargs);
      deleteRawResponse(generation.message);

      const message = recoverDsmlToolCalls(generation.message);
      if (reasoning.length > 0) {
        message.additional_kwargs = {
          ...message.additional_kwargs,
          reasoning_content: reasoning,
        };
      }
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
