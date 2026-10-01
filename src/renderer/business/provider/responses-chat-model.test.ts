import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Command, interrupt, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { createReactAgent, ToolNode } from "@langchain/langgraph/prebuilt";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { deserializeSaverState, serializeSaverState } from "../agent/checkpoint-serialization";
import { useAgentSupervisor } from "../agent/supervisor-agent";
import { useAiAnalysisService } from "../service/ai-analysis-service";
import { createStreamMergeState, mergeAiChunk } from "../service/stream-merge";
import { extractTokenUsage } from "../service/token-usage";
import { useModelProvider } from "./model-provider";
import { OfflineTokenChatOpenAI } from "./offline-token-chat-model";
import { buildOpenAIChatFields, PROXY_TOKEN_HEADER, UPSTREAM_BASE_URL_HEADER } from "./openai-fields";
import { messageContentToText } from "./token-estimate";

vi.mock("../../../common/store", () => ({
  PreferencesStore: { getInstanceOrCreate: () => ({}) },
}));
vi.mock("../../../common/utils/logger/logger-service", () => ({ default: () => ({ log: { debug: vi.fn() } }) }));
vi.mock("./chat-readiness", () => ({ buildAgentReadinessInput: () => ({}), isAgentConfigured: () => true }));
vi.mock("./model-provider", () => ({ useModelProvider: vi.fn() }));

const baseOptions = {
  apiKey: "sk-test",
  upstreamBaseUrl: "https://api.openai.com/v1",
  proxyBaseUrl: "http://127.0.0.1:1234",
  proxyToken: "test-proxy-token",
};

const sse = (events: Record<string, unknown>[]) =>
  new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

// Real SDK parsing of mocked Responses SSE, without an API key or a cluster.
const responseEvents = (output: Record<string, unknown>[], index: number) => {
  const response = {
    id: `resp_${index}`,
    object: "response",
    model: "gpt-6.1-sol",
    status: "completed",
    output,
    usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25, input_tokens_details: { cached_tokens: 4 } },
  };
  const events: Record<string, unknown>[] = [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
  ];
  output.forEach((item, output_index) => {
    events.push({
      type: "response.output_item.added",
      output_index,
      item:
        item.type === "function_call"
          ? { ...item, arguments: "", status: "in_progress" }
          : item.type === "message"
            ? { ...item, content: [], status: "in_progress" }
            : item,
    });
    if (item.type === "function_call") {
      events.push({
        type: "response.function_call_arguments.delta",
        item_id: item.id,
        output_index,
        delta: item.arguments,
      });
    } else if (item.type === "message") {
      for (const [content_index, part] of (
        item.content as { type: string; text?: string; refusal?: string }[]
      ).entries()) {
        if (part.type === "refusal") {
          events.push({
            type: "response.refusal.delta",
            item_id: item.id,
            output_index,
            content_index,
            delta: part.refusal,
          });
          events.push({
            type: "response.refusal.done",
            item_id: item.id,
            output_index,
            content_index,
            refusal: part.refusal,
          });
        } else {
          events.push({
            type: "response.output_text.delta",
            item_id: item.id,
            output_index,
            content_index,
            delta: part.text,
          });
        }
      }
    }
  });
  events.push({ type: "response.completed", response });
  return events;
};

const responseStream = (output: Record<string, unknown>[], index: number) => sse(responseEvents(output, index));

const answer = [
  {
    type: "message",
    id: "msg_answer",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "One pod is running.", annotations: [] }],
  },
];

describe("Responses chat model", () => {
  it.each(["gpt-5.3", "llama3.2"])("keeps %s on Chat Completions", async (modelName) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chat_test",
          object: "chat.completion",
          model: modelName,
          choices: [
            { index: 0, message: { role: "assistant", content: "One pod is running." }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName, reasoningEffort: "high" });
    const model = new OfflineTokenChatOpenAI({ ...fields, configuration: { ...fields.configuration, fetch } });
    const response = await model.invoke("Inspect pods");
    expect(String(fetch.mock.calls[0][0])).toBe(`${baseOptions.proxyBaseUrl}/openai/chat/completions`);
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    if (modelName !== "llama3.2") {
      expect(body.reasoning_effort).toBe("high");
      expect(body).not.toHaveProperty("temperature");
    } else {
      expect(body.temperature).toBe(0);
      expect(body).not.toHaveProperty("reasoning_effort");
    }
    expect(messageContentToText(response.content)).toBe("One pod is running.");
  });

  it.each([
    "gpt-5.4",
    "gpt-5.4-mini",
  ])("keeps the real %s supervisor on Chat Completions with Default effort", async (modelName) => {
    const routing = { reflection: "Inspect pods", goto: "analyzer" };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chat_route",
          object: "chat.completion",
          model: modelName,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_route",
                    type: "function",
                    function: { name: "extract", arguments: JSON.stringify(routing) },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName, reasoningEffort: "" });
    const model = new OfflineTokenChatOpenAI({ ...fields, configuration: { ...fields.configuration, fetch } });
    vi.mocked(useModelProvider).mockReturnValue({ getModel: () => model });
    const supervisor = await useAgentSupervisor().getAgent(["analyzer"], ["Inspect cluster resources"]);
    expect(await supervisor!.invoke({ messages: [new HumanMessage("Inspect pods")] })).toEqual(routing);
    expect(String(fetch.mock.calls[0][0])).toBe(`${baseOptions.proxyBaseUrl}/openai/chat/completions`);
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "extract" } });
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("temperature");
  });

  it("preserves tool calls and encrypted reasoning across approval and a checkpoint restart", async () => {
    const reasoning = { type: "reasoning", id: "rs_test", summary: [], encrypted_content: "encrypted-test" };
    const call = { type: "function_call", id: "fc_test", call_id: "call_test", name: "inspect", arguments: "{}" };
    const outputs = [[reasoning, call], answer];
    const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return responseStream(outputs[requests.length - 1], requests.length);
    });
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-6.1-sol", reasoningEffort: "high" });
    const model = new OfflineTokenChatOpenAI({
      ...fields,
      streaming: true,
      configuration: { ...fields.configuration, fetch },
    });
    const execute = vi.fn(async () => "One pod is running.");
    const inspect = tool(execute, {
      name: "inspect",
      description: "Inspect resources",
      schema: z.object({ namespace: z.string().optional() }),
    });
    const boundModel = model.bindTools([inspect], { parallel_tool_calls: false });
    const graph = new StateGraph(MessagesAnnotation)
      .addNode("agent", async (state) => ({ messages: [await boundModel.invoke(state.messages)] }))
      .addNode(
        "review",
        (state) => {
          const last = state.messages.at(-1);
          if (last && isAIMessage(last) && last.tool_calls?.length) {
            expect(interrupt("Approve inspection?")).toBe("yes");
            return new Command({ goto: "tools" });
          }
          return new Command({ goto: "__end__" });
        },
        { ends: ["tools", "__end__"] },
      )
      .addNode("tools", new ToolNode([inspect]))
      .addEdge("__start__", "agent")
      .addEdge("agent", "review")
      .addEdge("tools", "agent");
    const saver = new MemorySaver();
    const config = { configurable: { thread_id: "responses-test" } };
    await graph.compile({ checkpointer: saver }).invoke({ messages: [new HumanMessage("Inspect pods")] }, config);
    expect(execute).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);

    const restored = new MemorySaver();
    Object.assign(
      restored,
      deserializeSaverState(serializeSaverState({ storage: saver.storage, writes: saver.writes })),
    );
    const result = await graph.compile({ checkpointer: restored }).invoke(new Command({ resume: "yes" }), config);
    expect(execute).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe(`${baseOptions.proxyBaseUrl}/openai/responses`);
      expect(request.headers.get(UPSTREAM_BASE_URL_HEADER)).toBe(baseOptions.upstreamBaseUrl);
      expect(request.headers.get(PROXY_TOKEN_HEADER)).toBe(baseOptions.proxyToken);
      expect(request.body).toMatchObject({
        model: "gpt-6.1-sol",
        stream: true,
        store: false,
        reasoning: { effort: "high" },
        parallel_tool_calls: false,
      });
      expect(request.body).not.toHaveProperty("temperature");
      expect(request.body).not.toHaveProperty("previous_response_id");
      expect(request.body.tools).toMatchObject([{ type: "function", name: "inspect", strict: false }]);
      const tools = request.body.tools as { parameters: { required?: string[] } }[];
      expect(tools[0].parameters.required ?? []).not.toContain("namespace");
    }
    expect(requests[1].body.input).toEqual(
      expect.arrayContaining([
        reasoning,
        call,
        expect.objectContaining({ type: "function_call_output", call_id: "call_test", output: "One pod is running." }),
      ]),
    );
    const last = result.messages.at(-1);
    expect(messageContentToText(last?.content ?? "")).toBe("One pod is running.");
    expect(extractTokenUsage(isAIMessage(last!) ? last.usage_metadata : undefined)).toEqual({
      input: 20,
      cached: 4,
      output: 5,
    });
  });

  it.each([
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6.1-sol",
  ])("routes the real %s supervisor through Responses with reasoning and tools", async (modelName) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      responseStream(
        [
          {
            type: "function_call",
            id: "fc_route",
            call_id: "call_route",
            name: "extract",
            arguments: JSON.stringify({ reflection: "Inspect pods", goto: "analyzer" }),
          },
        ],
        1,
      ),
    );
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName, reasoningEffort: "high" });
    const model = new OfflineTokenChatOpenAI({
      ...fields,
      streaming: true,
      configuration: { ...fields.configuration, fetch },
    });
    vi.mocked(useModelProvider).mockReturnValue({ getModel: () => model });
    const supervisor = await useAgentSupervisor().getAgent(["analyzer"], ["Inspect cluster resources"]);
    const response = await supervisor!.invoke({ messages: [new HumanMessage("Inspect pods")] });
    expect(String(fetch.mock.calls[0][0])).toBe(`${baseOptions.proxyBaseUrl}/openai/responses`);
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.tool_choice).toEqual({ type: "function", name: "extract" });
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.tools).toMatchObject([{ type: "function", name: "extract", strict: false }]);
    expect(response).toEqual({
      reflection: "Inspect pods",
      goto: "analyzer",
    });
  });

  it.each(["", "Partial answer"])("propagates response.failed after output %j", async (partial) => {
    const error = { code: "server_error", message: "The server had an error while processing your request." };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () =>
        sse([
          { type: "response.created", response: { id: "resp_failed", model: "gpt-6.1-sol", output: [] } },
          ...(partial
            ? [{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: partial }]
            : []),
          { type: "response.failed", response: { id: "resp_failed", status: "failed", error, output: [] } },
        ]),
      );
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-6.1-sol" });
    const model = new OfflineTokenChatOpenAI({
      ...fields,
      streaming: true,
      configuration: { ...fields.configuration, fetch },
    });
    vi.mocked(useModelProvider).mockReturnValue({ getModel: () => model });
    const chunks: string[] = [];
    const analyze = async () => {
      for await (const chunk of useAiAnalysisService().analyze("Inspect pods")) chunks.push(chunk);
    };
    await expect(analyze()).rejects.toMatchObject({ name: error.code, message: error.message });
    expect(chunks.join("")).toBe(partial);
    await expect(model.invoke("Inspect pods")).rejects.toMatchObject({ name: error.code, message: error.message });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    { streaming: false, messagesMode: false, missingTerminal: false },
    { streaming: true, messagesMode: false, missingTerminal: false },
    { streaming: true, messagesMode: true, missingTerminal: false },
    { streaming: true, messagesMode: true, missingTerminal: true },
  ])("rejects incomplete tool arguments before execution: %j", async ({ streaming, messagesMode, missingTerminal }) => {
    const call = {
      type: "function_call",
      id: "fc_incomplete",
      call_id: "call_incomplete",
      name: "inspect",
      arguments: streaming ? '{"namespace":"production"' : '{"namespace":"production"}',
      status: "incomplete",
    };
    const events = responseEvents([call], 1);
    const incomplete = {
      ...(events.at(-1)?.response as Record<string, unknown>),
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    };
    events[events.length - 1] = { type: "response.incomplete", response: incomplete };
    if (missingTerminal) {
      events.pop();
    }
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (_url, init) =>
        JSON.parse(String(init?.body)).stream
          ? sse(events)
          : new Response(JSON.stringify(incomplete), { headers: { "Content-Type": "application/json" } }),
      );
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-6.1-sol" });
    const model = new OfflineTokenChatOpenAI({
      ...fields,
      streaming,
      configuration: { ...fields.configuration, fetch },
    });
    const execute = vi.fn(async () => "One pod is running.");
    const inspect = tool(execute, {
      name: "inspect",
      description: "Inspect resources",
      schema: z.object({ namespace: z.string().optional(), selector: z.string().optional() }),
    });
    const boundModel = model.bindTools([inspect]);
    const graph = new StateGraph(MessagesAnnotation)
      .addNode("agent", async (state) => ({ messages: [await boundModel.invoke(state.messages)] }))
      .addNode("tools", new ToolNode([inspect]))
      .addEdge("__start__", "agent")
      .addEdge("agent", "tools")
      .addEdge("tools", "__end__")
      .compile();
    const run = async () => {
      const input = { messages: [new HumanMessage("Inspect production pods")] };
      if (messagesMode) {
        for await (const _chunk of await graph.stream(input, { streamMode: "messages" })) {
          // Consume the entire stream so terminal validation runs.
        }
      } else {
        await graph.invoke(input);
      }
    };
    await expect(run()).rejects.toMatchObject({
      name: missingTerminal ? "response_stream_incomplete" : "response_incomplete",
      message: expect.stringContaining(missingTerminal ? "response.completed" : "max_output_tokens"),
    });
    expect(execute).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).stream).toBe(streaming);
  });

  it.each(["", "Partial answer"])("rejects SSE EOF without completion after output %j", async (partial) => {
    const output = partial
      ? [{ ...answer[0], content: [{ type: "output_text", text: partial, annotations: [] }] }]
      : [];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => sse(responseEvents(output, 1).slice(0, -1)));
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-6.1-sol" });
    const model = new OfflineTokenChatOpenAI({
      ...fields,
      streaming: true,
      configuration: { ...fields.configuration, fetch },
    });
    vi.mocked(useModelProvider).mockReturnValue({ getModel: () => model });
    const chunks: string[] = [];
    const analyze = async () => {
      for await (const chunk of useAiAnalysisService().analyze("Inspect pods")) chunks.push(chunk);
    };
    const error = { name: "response_stream_incomplete", message: expect.stringContaining("response.completed") };
    await expect(analyze()).rejects.toMatchObject(error);
    expect(chunks.join("")).toBe(partial);
    await expect(model.invoke("Inspect pods")).rejects.toMatchObject(error);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("shows refusal text in invoke with streaming=%s and preserves metadata", async (streaming) => {
    const refusal = "I cannot help with that request.";
    const output = [{ ...answer[0], content: [{ type: "refusal", refusal }] }];
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.stream
        ? responseStream(output, 1)
        : new Response(
            JSON.stringify({
              id: "resp_refusal",
              model: "gpt-6.1-sol",
              status: "completed",
              output,
              output_text: "",
            }),
            { headers: { "Content-Type": "application/json" } },
          );
    });
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-6.1-sol" });
    const model = new OfflineTokenChatOpenAI({
      ...fields,
      streaming,
      configuration: { ...fields.configuration, fetch },
    });
    const response = await model.invoke("Inspect pods");
    expect(messageContentToText(response.content)).toBe(refusal);
    expect(response.additional_kwargs.refusal).toBe(refusal);
    expect(response.response_metadata.output).toEqual(output);
    vi.mocked(useModelProvider).mockReturnValue({ getModel: () => model });
    const chunks: string[] = [];
    for await (const chunk of useAiAnalysisService().analyze("Inspect pods")) chunks.push(chunk);
    expect(chunks.join("")).toBe(refusal);

    const graph = new StateGraph(MessagesAnnotation)
      .addNode("agent", async (state) => ({ messages: [await model.invoke(state.messages)] }))
      .addEdge("__start__", "agent")
      .addEdge("agent", "__end__")
      .compile();
    const merged: string[] = [];
    const state = createStreamMergeState();
    for await (const [chunk, metadata] of await graph.stream(
      { messages: [new HumanMessage("Inspect pods")] },
      { streamMode: "messages" },
    ))
      merged.push(mergeAiChunk(state, chunk, metadata));
    expect(merged.join("")).toBe(refusal);
  });

  it.each([
    { streaming: false, phases: true, refusal: false, emptyFirst: false },
    { streaming: true, phases: true, refusal: false, emptyFirst: false },
    { streaming: false, phases: false, refusal: false, emptyFirst: false },
    { streaming: true, phases: false, refusal: false, emptyFirst: false },
    { streaming: false, phases: true, refusal: true, emptyFirst: false },
    { streaming: true, phases: true, refusal: true, emptyFirst: false },
    { streaming: false, phases: true, refusal: false, emptyFirst: true },
    { streaming: true, phases: true, refusal: false, emptyFirst: true },
  ])("preserves assistant output boundaries in invoke, AI Explain, and LangGraph: %j", async ({
    streaming,
    phases,
    refusal,
    emptyFirst,
  }) => {
    const finalText = refusal ? "I cannot help with that request." : "### Result\nOne pod is running.";
    const output = [
      {
        ...answer[0],
        id: "msg_commentary",
        ...(phases ? { phase: "commentary" } : {}),
        content: emptyFirst ? [] : [{ type: "output_text", text: "Inspecting pods.", annotations: [] }],
      },
      {
        ...answer[0],
        id: "msg_final",
        ...(phases ? { phase: "final_answer" } : {}),
        content: refusal
          ? [{ type: "refusal", refusal: finalText }]
          : [
              {
                type: "output_text",
                text: finalText,
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/pods",
                    title: "Pods",
                    start_index: 11,
                    end_index: 14,
                  },
                ],
              },
            ],
      },
    ];
    const events = responseEvents(output, 1).flatMap((event) =>
      event.type === "response.output_text.delta"
        ? [
            { ...event, delta: String(event.delta).slice(0, 3) },
            { ...event, delta: String(event.delta).slice(3) },
          ]
        : [event],
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (_url, init) =>
        JSON.parse(String(init?.body)).stream
          ? sse(events)
          : new Response(JSON.stringify(events.at(-1)?.response), { headers: { "Content-Type": "application/json" } }),
      );
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-6.1-sol" });
    const model = new OfflineTokenChatOpenAI({
      ...fields,
      streaming,
      configuration: { ...fields.configuration, fetch },
    });
    const expected = `${emptyFirst ? "" : "Inspecting pods.\n\n"}${finalText}`;
    const result = await model.invoke("Inspect pods");
    expect(messageContentToText(result.content)).toBe(expected);
    expect(result.response_metadata.output).toEqual(output);
    if (refusal) expect(result.additional_kwargs.refusal).toBe(finalText);
    if (!streaming && !refusal) {
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            annotations: [expect.objectContaining({ type: "citation", url: "https://example.com/pods" })],
          }),
        ]),
      );
    }

    vi.mocked(useModelProvider).mockReturnValue({ getModel: () => model });
    const analysis: string[] = [];
    for await (const chunk of useAiAnalysisService().analyze("Inspect pods")) analysis.push(chunk);
    expect(analysis.join("")).toBe(expected);

    const graph = new StateGraph(MessagesAnnotation)
      .addNode("agent", async (state) => ({ messages: [await model.invoke(state.messages)] }))
      .addEdge("__start__", "agent")
      .addEdge("agent", "__end__")
      .compile();
    const state = createStreamMergeState();
    const merged: string[] = [];
    for await (const [chunk, metadata] of await graph.stream(
      { messages: [new HumanMessage("Inspect pods")] },
      { streamMode: "messages" },
    )) {
      merged.push(mergeAiChunk(state, chunk, metadata));
    }
    expect(merged.join("")).toBe(expected);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    { blocks: [["A", "B"], ["C"]], phases: true },
    { blocks: [["A", "B"], ["C"]], phases: false },
    {
      blocks: [
        ["A0", "A1"],
        ["B0", "B1"],
      ],
      phases: true,
    },
    {
      blocks: [
        ["A0", "A1"],
        ["B0", "B1"],
      ],
      phases: false,
    },
  ])("keeps multiple text blocks in order through invoke, checkpoints, and downstream context: %j", async ({
    blocks,
    phases,
  }) => {
    const output = blocks.map((parts, output_index) => ({
      ...answer[0],
      id: `msg_blocks_${output_index}`,
      ...(phases ? { phase: output_index === 0 ? "commentary" : "final_answer" } : {}),
      content: parts.map((text, content_index) => ({
        type: "output_text",
        text,
        annotations: [
          {
            type: "url_citation",
            url: `https://example.com/${output_index}/${content_index}`,
            title: "Source",
            start_index: 0,
            end_index: text.length,
          },
        ],
      })),
    }));
    const events = responseEvents(output, 1).flatMap((event) => {
      if (event.type !== "response.output_text.delta") return [event];
      const part = output[event.output_index as number].content[event.content_index as number];
      return [
        { ...event, delta: part.text.slice(0, 1) },
        { ...event, delta: part.text.slice(1) },
        {
          type: "response.output_text.annotation.added",
          output_index: event.output_index,
          content_index: event.content_index,
          item_id: event.item_id,
          annotation_index: 0,
          annotation: part.annotations[0],
        },
      ];
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => sse(events));
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-6.1-sol" });
    const makeModel = (streaming?: boolean) =>
      new OfflineTokenChatOpenAI({
        ...fields,
        ...(streaming === undefined ? {} : { streaming }),
        configuration: { ...fields.configuration, fetch },
      });
    const expected = blocks.map((parts) => parts.join("")).join("\n\n");
    const result = await makeModel(true).invoke("Inspect pods");
    expect(messageContentToText(result.content)).toBe(expected);
    expect(result.response_metadata.output).toEqual(output);
    for (const [output_index, item] of output.entries()) {
      for (const [content_index, part] of item.content.entries()) {
        expect(result.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              index: `${output_index}:${content_index}`,
              text: `${output_index > 0 && content_index === 0 ? "\n\n" : ""}${part.text}`,
              annotations: [expect.objectContaining({ url: part.annotations[0].url })],
            }),
          ]),
        );
      }
    }

    const inner = createReactAgent({ llm: makeModel(), tools: [] });
    let finalContent = "";
    let downstreamContent = "";
    const buildGraph = (saver: MemorySaver) =>
      new StateGraph(MessagesAnnotation)
        .addNode("agent", async (state, config) => {
          const reply = await inner.invoke(state, config);
          const last = reply.messages.at(-1)!;
          finalContent = messageContentToText(last.content);
          expect(last.response_metadata).toMatchObject({ output });
          // Match the application's config forwarding and result wrapping.
          return { messages: [new HumanMessage({ content: last.content })] };
        })
        .addNode("next", (state) => {
          downstreamContent = messageContentToText(state.messages.at(-1)!.content);
          return {};
        })
        .addEdge("__start__", "agent")
        .addEdge("agent", "next")
        .addEdge("next", "__end__")
        .compile({ checkpointer: saver });
    const saver = new MemorySaver();
    const graph = buildGraph(saver);
    const config = { configurable: { thread_id: "blocks-test" } };
    const mergeState = createStreamMergeState();
    let visible = "";
    for await (const [chunk, metadata] of await graph.stream(
      { messages: [new HumanMessage("Inspect pods")] },
      { ...config, streamMode: "messages" },
    )) {
      if (chunk.getType() === "ai") visible += mergeAiChunk(mergeState, chunk, metadata);
    }
    expect(visible).toBe(expected);
    expect(finalContent).toBe(expected);
    expect(downstreamContent).toBe(expected);
    const checkpoint = await graph.getState(config);
    expect(messageContentToText(checkpoint.values.messages.at(-1).content)).toBe(expected);
    const restored = new MemorySaver();
    Object.assign(
      restored,
      deserializeSaverState(serializeSaverState({ storage: saver.storage, writes: saver.writes })),
    );
    const restoredCheckpoint = await buildGraph(restored).getState(config);
    expect(messageContentToText(restoredCheckpoint.values.messages.at(-1).content)).toBe(expected);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) expect(JSON.parse(String(init?.body)).stream).toBe(true);
  });

  it("renders Responses text blocks in the analysis service", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      responseStream(
        [
          {
            type: "reasoning",
            id: "rs_analysis",
            summary: [{ type: "summary_text", text: "Internal reasoning" }],
            encrypted_content: "encrypted-analysis",
          },
          ...answer,
        ],
        1,
      ),
    );
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-6.1-sol" });
    const model = new OfflineTokenChatOpenAI({ ...fields, configuration: { ...fields.configuration, fetch } });
    vi.mocked(useModelProvider).mockReturnValue({ getModel: () => model });
    const chunks: string[] = [];
    for await (const chunk of useAiAnalysisService().analyze("Inspect pods")) chunks.push(chunk);
    expect(chunks.join("")).toBe("One pod is running.");
  });
});
