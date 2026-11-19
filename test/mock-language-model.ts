// A stand-in language model for the tests of the agents: the mock model of the
// AI SDK, whose streamed answer to every call is chosen by the test from the
// prompt of the call, so a test scripts a whole tool loop without an endpoint.

import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";

import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";

export const usage = (input: number, output: number, cacheRead = 0, cacheWrite?: number): LanguageModelV4Usage => ({
  inputTokens: { total: input, noCache: input - cacheRead, cacheRead, cacheWrite },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

export const textParts = (text: string, id = "text-1"): LanguageModelV4StreamPart[] => [
  { type: "text-start", id },
  { type: "text-delta", id, delta: text },
  { type: "text-end", id },
];

export const reasoningParts = (text: string, id = "reasoning-1"): LanguageModelV4StreamPart[] => [
  { type: "reasoning-start", id },
  { type: "reasoning-delta", id, delta: text },
  { type: "reasoning-end", id },
];

export const toolCallPart = (
  toolName: string,
  input: Record<string, unknown>,
  toolCallId = "call-1",
): LanguageModelV4StreamPart => ({ type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) });

export const finishPart = (
  reason: "stop" | "tool-calls",
  callUsage: LanguageModelV4Usage = usage(10, 5),
): LanguageModelV4StreamPart => ({
  type: "finish",
  finishReason: { unified: reason, raw: undefined },
  usage: callUsage,
});

// The text of a message of a prompt, the results of tool calls included.
export const messageText = (message: LanguageModelV4Message | undefined): string => {
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type === "tool-result") {
        const output = part.output as { type: string; value?: unknown; reason?: string };
        return output.type === "execution-denied" ? `denied: ${output.reason ?? ""}` : String(output.value ?? "");
      }
      return "";
    })
    .join("");
};

/**
 * A model whose streamed answer to every call is the parts the script returns
 * for the prompt of the call.
 */
export const scriptedModel = (
  script: (prompt: LanguageModelV4Prompt, options: LanguageModelV4CallOptions) => LanguageModelV4StreamPart[],
) =>
  new MockLanguageModelV4({
    doStream: async (options) => ({
      stream: convertArrayToReadableStream<LanguageModelV4StreamPart>([
        { type: "stream-start", warnings: [] },
        ...script(options.prompt, options),
      ]),
    }),
  });
