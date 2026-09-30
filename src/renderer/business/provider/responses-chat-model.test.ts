import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Command, interrupt, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { deserializeSaverState, serializeSaverState } from "../agent/checkpoint-serialization";
import { recoverSupervisorRouting } from "../agent/supervisor-routing";
import { useAiAnalysisService } from "../service/ai-analysis-service";
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

// Real SDK parsing of mocked Responses SSE, without an API key or a cluster.
const responseStream = (output: Record<string, unknown>[], index: number) => {
  const response = {
    id: `resp_${index}`,
    object: "response",
    model: "gpt-6.1-sol",
    status: "completed",
    output,
    usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25, input_tokens_details: { cached_tokens: 4 } },
  };
  const events: Record<string, unknown>[] = [{ type: "response.created", response: { ...response, output: [] } }];
  output.forEach((item, output_index) => {
    events.push({
      type: "response.output_item.added",
      output_index,
      item: item.type === "function_call" ? { ...item, arguments: "" } : item,
    });
    if (item.type === "function_call") {
      events.push({ type: "response.function_call_arguments.delta", output_index, delta: item.arguments });
    } else if (item.type === "message") {
      for (const part of item.content as { text: string }[]) {
        events.push({ type: "response.output_text.delta", output_index, content_index: 0, delta: part.text });
      }
    }
  });
  events.push({ type: "response.completed", response });
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
};

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
  it.each(["gpt-5.5", "llama3.2"])("keeps %s on Chat Completions", async (modelName) => {
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
    if (modelName === "gpt-5.5") {
      expect(body.reasoning_effort).toBe("high");
      expect(body).not.toHaveProperty("temperature");
    } else {
      expect(body.temperature).toBe(0);
      expect(body).not.toHaveProperty("reasoning_effort");
    }
    expect(messageContentToText(response.content)).toBe("One pod is running.");
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

  it("converts the supervisor's forced tool choice and recovers its routing", async () => {
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
    const fields = buildOpenAIChatFields({ ...baseOptions, modelName: "gpt-6.1-sol" });
    const model = new OfflineTokenChatOpenAI({
      ...fields,
      streaming: true,
      configuration: { ...fields.configuration, fetch },
    });
    const response = await model
      .bindTools(
        [
          {
            type: "function",
            function: {
              name: "extract",
              parameters: {
                type: "object",
                properties: { reflection: { type: "string" }, goto: { type: "string" } },
                required: ["reflection", "goto"],
              },
            },
          },
        ],
        { tool_choice: "extract" },
      )
      .invoke("Inspect pods");
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.tool_choice).toEqual({ type: "function", name: "extract" });
    expect(body).not.toHaveProperty("reasoning");
    expect(recoverSupervisorRouting(response, ["analyzer", "__end__"], ["analyzer"])).toEqual({
      reflection: "Inspect pods",
      goto: "analyzer",
    });
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
