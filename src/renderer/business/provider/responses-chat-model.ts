import {
  ChatOpenAIResponses,
  convertMessagesToResponsesInput,
  convertResponsesDeltaToChatGenerationChunk,
  convertResponsesMessageToAIMessage,
  wrapOpenAIClientError,
} from "@langchain/openai";
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

const showResponseMessages = (generation: ChatGeneration): void => {
  const response = generation.message.response_metadata as OpenAIClient.Responses.Response;
  let hasText = false;
  // Reuse LangChain's content conversion, retaining the original output for replay.
  generation.message.content = response.output.flatMap((item) => {
    const part = { message: convertResponsesMessageToAIMessage({ ...response, output: [item] }), text: "" };
    showRefusal(part);
    const content = part.message.content;
    if (item.type !== "message" || !messageContentToText(content)) {
      return typeof content === "string" ? [{ type: "text", text: content }] : content;
    }
    const separator = hasText ? [{ type: "text", text: "\n\n" }] : [];
    hasText = true;
    return [...separator, ...(typeof content === "string" ? [{ type: "text", text: content }] : content)];
  });
  generation.text = messageContentToText(generation.message.content);
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
      let completed = false;
      for await (const event of stream) {
        if (
          event.type === "response.failed" ||
          event.type === "response.incomplete" ||
          event.type === "response.completed"
        ) {
          requireCompletedResponse(event.response);
          completed = event.type === "response.completed";
        }
        yield event;
      }
      if (!completed) {
        const error = new Error("OpenAI response stream ended before response.completed.");
        error.name = "response_stream_incomplete";
        throw error;
      }
    })();
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const stream = await this.completionWithRetry(
      {
        ...this.invocationParams(options),
        input: convertMessagesToResponsesInput({ messages, zdrEnabled: this.zdrEnabled ?? false, model: this.model }),
        stream: true,
      },
      options,
    );
    // LangChain drops output_index during conversion; keep it until text is rendered.
    let lastTextOutputIndex: number | undefined;
    try {
      for await (const event of stream) {
        if (options.signal?.aborted) return;
        const chunk = convertResponsesDeltaToChatGenerationChunk(event);
        if (!chunk) continue;
        // Content indices restart in each output message; qualify them for LangChain concat.
        if ("output_index" in event && Array.isArray(chunk.message.content)) {
          chunk.message.content = chunk.message.content.map((part) =>
            part.type === "text" && part.index !== undefined
              ? { ...part, index: `${event.output_index}:${part.index}` }
              : part,
          );
        }
        showRefusal(chunk);
        if (messageContentToText(chunk.message.content) && "output_index" in event) {
          if (lastTextOutputIndex !== undefined && event.output_index !== lastTextOutputIndex) {
            const content = chunk.message.content;
            chunk.message.content =
              typeof content === "string"
                ? `\n\n${content}`
                : content.map((part) => (part.type === "text" ? { ...part, text: `\n\n${part.text}` } : part));
            chunk.text = messageContentToText(chunk.message.content);
          }
          lastTextOutputIndex = event.output_index;
        }
        yield chunk;
        await runManager?.handleLLMNewToken(
          chunk.text || "",
          { prompt: options.promptIndex ?? 0, completion: 0 },
          undefined,
          undefined,
          undefined,
          { chunk },
        );
      }
    } catch (error) {
      throw wrapOpenAIClientError(error);
    }
  }

  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const result = await super._generate(messages, options, runManager);
    if (!this.invocationParams(options).stream) {
      result.generations.forEach(showResponseMessages);
    }
    return result;
  }
}
