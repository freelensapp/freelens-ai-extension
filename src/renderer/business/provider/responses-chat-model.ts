import { ChatOpenAIResponses } from "@langchain/openai";
import { messageContentToText } from "./token-estimate";

import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGeneration, ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import type { OpenAIClient } from "@langchain/openai";

const requireCompletedResponse = (response: OpenAIClient.Responses.Response): void => {
  if (response.status === "completed" && !response.error) {
    return;
  }
  const status = response.status ?? "not_completed";
  const reason = response.incomplete_details?.reason;
  const error = new Error(response.error?.message ?? `OpenAI response ${status}${reason ? `: ${reason}` : "."}`);
  error.name = response.error?.code ?? `response_${status}`;
  throw error;
};

const showRefusal = (generation: ChatGeneration): void => {
  const refusal = generation.message.additional_kwargs.refusal;
  if (typeof refusal === "string") {
    const content = generation.message.content;
    generation.message.content =
      typeof content === "string" ? content + refusal : [...content, { type: "text", text: refusal }];
    generation.text = messageContentToText(generation.message.content);
  }
};

// LangChain 1.5.3 accepts incomplete responses and keeps refusal text only in metadata.
// Adapt the Responses worker so invoke, stream, and LangGraph callbacks agree.
export class ResponsesChatOpenAI extends ChatOpenAIResponses {
  override completionWithRetry(
    request: OpenAIClient.Responses.ResponseCreateParamsStreaming,
    options?: OpenAIClient.RequestOptions,
  ): Promise<AsyncIterable<OpenAIClient.Responses.ResponseStreamEvent>>;
  override completionWithRetry(
    request: OpenAIClient.Responses.ResponseCreateParamsNonStreaming,
    options?: OpenAIClient.RequestOptions,
  ): Promise<OpenAIClient.Responses.Response>;
  override async completionWithRetry(
    request: OpenAIClient.Responses.ResponseCreateParams,
    options?: OpenAIClient.RequestOptions,
  ): Promise<AsyncIterable<OpenAIClient.Responses.ResponseStreamEvent> | OpenAIClient.Responses.Response> {
    if (!request.stream) {
      const response = await super.completionWithRetry({ ...request, stream: false }, options);
      requireCompletedResponse(response);
      return response;
    }
    const stream = await super.completionWithRetry({ ...request, stream: true }, options);
    return (async function* () {
      for await (const event of stream) {
        if (
          event.type === "response.failed" ||
          event.type === "response.incomplete" ||
          event.type === "response.completed"
        ) {
          requireCompletedResponse(event.response);
        }
        yield event;
      }
    })();
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    for await (const chunk of super._streamResponseChunks(messages, options, runManager)) {
      showRefusal(chunk);
      yield chunk;
    }
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const result = await super._generate(messages, options, runManager);
    if (!this.invocationParams(options).stream) {
      result.generations.forEach(showRefusal);
    }
    return result;
  }
}
