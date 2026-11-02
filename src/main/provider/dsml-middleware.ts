// A language model middleware for DeepSeek models served through
// OpenAI-compatible endpoints that do not parse the model's native tool calls
// server-side.
//
// Those endpoints leak DeepSeek's "DSML" tool-call markup into the assistant
// text instead of returning a structured `tool_calls` field, so the markup
// would surface verbatim in the UI and no tool would ever run. This middleware
// recovers the tool calls from the markup (see `parseDsmlToolCalls`) so the
// agent loop executes them, and approvals are asked for them, as for any other
// tool call.
//
// The text of a step is held back until the step finishes, since the markup
// can only be parsed whole; the reasoning, which `@ai-sdk/openai-compatible`
// reads from `reasoning_content` itself, still streams as it is generated.
// Used only for the models of `emitsDsmlToolCalls`, so other models keep their
// token-by-token text.

import { generateId } from "ai";
import { parseDsmlToolCalls } from "../agents/leaked-tool-calls";

import type {
  LanguageModelV4Content,
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolCall,
} from "@ai-sdk/provider";
import type { LanguageModelMiddleware } from "ai";

const TEXT_ID = "dsml-text";

// The tool calls recovered from the text, with ids that are unique in the
// conversation: approvals and tool results are matched by id across all the
// stored messages.
const recover = (text: string): { cleanedText: string; toolCalls: LanguageModelV4ToolCall[] } | undefined => {
  const { cleanedText, toolCalls } = parseDsmlToolCalls(text);
  if (toolCalls.length === 0) {
    return undefined;
  }
  return {
    cleanedText,
    toolCalls: toolCalls.map(({ name, args }) => ({
      type: "tool-call",
      toolCallId: `dsml_${generateId()}`,
      toolName: name,
      input: JSON.stringify(args),
    })),
  };
};

const toolCallsFinishReason = (finishReason: LanguageModelV4FinishReason): LanguageModelV4FinishReason => ({
  unified: "tool-calls",
  raw: finishReason.raw,
});

export const dsmlToolCallMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v4",

  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    if (result.content.some((part) => part.type === "tool-call")) {
      return result;
    }
    const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    const recovered = recover(text);
    if (!recovered) {
      return result;
    }
    const content: LanguageModelV4Content[] = [
      ...result.content.filter((part) => part.type !== "text"),
      ...(recovered.cleanedText ? [{ type: "text" as const, text: recovered.cleanedText }] : []),
      ...recovered.toolCalls,
    ];
    return { ...result, content, finishReason: toolCallsFinishReason(result.finishReason) };
  },

  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    let text = "";
    let hasToolCall = false;

    const transform = new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
      transform(part, controller) {
        switch (part.type) {
          // Held back until the step finishes.
          case "text-start":
          case "text-end":
            return;
          case "text-delta":
            text += part.delta;
            return;
          case "tool-call":
            hasToolCall = true;
            controller.enqueue(part);
            return;
          case "finish": {
            const recovered = hasToolCall ? undefined : recover(text);
            const finalText = recovered ? recovered.cleanedText : text;
            if (finalText) {
              controller.enqueue({ type: "text-start", id: TEXT_ID });
              controller.enqueue({ type: "text-delta", id: TEXT_ID, delta: finalText });
              controller.enqueue({ type: "text-end", id: TEXT_ID });
            }
            for (const toolCall of recovered?.toolCalls ?? []) {
              controller.enqueue(toolCall);
            }
            controller.enqueue(recovered ? { ...part, finishReason: toolCallsFinishReason(part.finishReason) } : part);
            return;
          }
          default:
            controller.enqueue(part);
        }
      },
    });

    return { stream: stream.pipeThrough(transform), ...rest };
  },
};
