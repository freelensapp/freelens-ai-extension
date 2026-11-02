import { streamText, wrapLanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { finishPart, reasoningParts, scriptedModel, textParts, toolCallPart } from "../../../test/mock-language-model";
import { dsmlToolCallMiddleware } from "./dsml-middleware";

import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

const LEAKED =
  'Listing them.<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="listKubernetesResources">' +
  '<｜｜DSML｜｜parameter name="kind" string="true">Pod</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>';

// The parts of one streamed model call through the middleware.
const streamThrough = async (parts: LanguageModelV4StreamPart[]) => {
  const model = wrapLanguageModel({ model: scriptedModel(() => parts), middleware: dsmlToolCallMiddleware });
  const { stream } = await model.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "pods?" }] }] });
  const collected: LanguageModelV4StreamPart[] = [];
  for await (const part of stream) {
    collected.push(part);
  }
  return collected;
};

describe("dsmlToolCallMiddleware", () => {
  it("turns the DSML markup of a streamed answer into a tool call and keeps the text before it", async () => {
    const parts = await streamThrough([...reasoningParts("thinking"), ...textParts(LEAKED), finishPart("stop")]);

    expect(parts.filter(({ type }) => type === "reasoning-delta")).toHaveLength(1);
    expect(parts.filter((part) => part.type === "text-delta")).toEqual([
      expect.objectContaining({ delta: "Listing them." }),
    ]);
    const toolCalls = parts.filter((part) => part.type === "tool-call");
    expect(toolCalls).toEqual([
      expect.objectContaining({ toolName: "listKubernetesResources", input: JSON.stringify({ kind: "Pod" }) }),
    ]);
    expect((toolCalls[0] as { toolCallId: string }).toolCallId).toMatch(/^dsml_/);
    expect(parts.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "tool-calls" } });
  });

  it("gives every recovered call an id of its own", async () => {
    const first = await streamThrough([...textParts(LEAKED), finishPart("stop")]);
    const second = await streamThrough([...textParts(LEAKED), finishPart("stop")]);

    const idOf = (parts: LanguageModelV4StreamPart[]) =>
      (parts.find((part) => part.type === "tool-call") as { toolCallId: string }).toolCallId;
    expect(idOf(first)).not.toBe(idOf(second));
  });

  it("passes a plain answer and a structured tool call through", async () => {
    const plain = await streamThrough([...textParts("No tools needed."), finishPart("stop")]);
    expect(plain.filter((part) => part.type === "text-delta")).toEqual([
      expect.objectContaining({ delta: "No tools needed." }),
    ]);
    expect(plain.at(-1)).toMatchObject({ finishReason: { unified: "stop" } });

    const structured = await streamThrough([toolCallPart("getNamespaces", {}), finishPart("tool-calls")]);
    expect(structured.filter((part) => part.type === "tool-call")).toEqual([
      expect.objectContaining({ toolName: "getNamespaces", toolCallId: "call-1" }),
    ]);
  });

  it("lets the agent loop run the recovered call", async () => {
    const result = streamText({
      model: wrapLanguageModel({
        model: scriptedModel(() => [...textParts(LEAKED), finishPart("stop")]),
        middleware: dsmlToolCallMiddleware,
      }),
      prompt: "pods?",
    });

    expect(await result.toolCalls).toMatchObject([{ toolName: "listKubernetesResources", input: { kind: "Pod" } }]);
  });
});
