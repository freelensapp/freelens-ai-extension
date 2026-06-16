// A `ChatOpenAI` subclass for DeepSeek models served through OpenAI-compatible
// endpoints that do not parse the model's native tool calls server-side.
//
// Those endpoints leak DeepSeek's "DSML" tool-call markup into the assistant
// text instead of returning a structured `tool_calls` field. LangChain only
// reads `tool_calls`, so the markup surfaces verbatim in the UI and no tool ever
// runs. This client recovers the tool calls from the markup (see
// `recoverDsmlToolCalls`) so the agent graph executes them normally.
//
// HTTP streaming is disabled (`disableStreaming = true`) so every request goes
// through `_generate` and returns a single complete message: the DSML markup is
// only recoverable once the whole tool-call block has arrived, and the
// token-level streaming path would otherwise leak the markup to the UI before we
// could rewrite it. Used only for DeepSeek models, so other models keep
// token-by-token streaming intact.

import { ChatOpenAI } from "@langchain/openai";
import { recoverDsmlToolCalls } from "../agent/leaked-tool-calls";

import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export class DsmlAwareChatOpenAI extends ChatOpenAI {
  // Force the non-streaming `_generate` path; see the file header.
  disableStreaming = true;

  /** @ignore */
  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const result = await super._generate(messages, options, runManager);

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
