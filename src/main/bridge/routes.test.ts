import { afterEach, describe, expect, it, vi } from "vitest";
import { finishPart, messageText, scriptedModel, textParts, toolCallPart } from "../../../test/mock-language-model";
import { BRIDGE_TOKEN_HEADER, BridgeRoute } from "../../common/bridge/protocol";
import { readSseEvents } from "../../common/bridge/sse";
import { AgentStateStore, PreferencesStore } from "../../common/store";
import { AgentRuntime } from "../agents/agent-runtime";
import { createBridgeRoutes, parseAgentRunRequest, parseConversationRequest, parseExplainRequest } from "./routes";
import { type BridgeServer, startBridgeServer } from "./server";

import type { AgentRunRequest } from "../../common/bridge/protocol";

// The model of a real runtime, scripted: it asks to delete a pod when the
// prompt names pods, which waits on the user's approval before anything runs,
// and otherwise answers with what it saw last. The tool acts on a cluster
// Freelens does not know, so it answers with a message and sends nothing.
const model = () =>
  scriptedModel((prompt) => {
    const last = prompt.at(-1);
    if (last?.role === "user" && messageText(last).includes("pods")) {
      return [
        toolCallPart("deletePod", { name: "web-1", namespace: "default", mode: "evict" }),
        finishPart("tool-calls"),
      ];
    }
    return [
      ...textParts(`${last?.role === "tool" ? "tool saw" : "answer to"}: ${messageText(last)}`),
      finishPart("stop"),
    ];
  });

describe("parseAgentRunRequest", () => {
  it("reads a message run", () => {
    expect(
      parseAgentRunRequest({ clusterId: "c1", conversationId: "t1", input: { kind: "message", text: "hi" } }),
    ).toEqual({ clusterId: "c1", conversationId: "t1", input: { kind: "message", text: "hi", summary: null } });
  });

  it("keeps the summary of a just compacted session", () => {
    expect(
      parseAgentRunRequest({
        clusterId: "c1",
        conversationId: "t1",
        input: { kind: "message", text: "hi", summary: "earlier" },
      }).input,
    ).toEqual({ kind: "message", text: "hi", summary: "earlier" });
  });

  it("reads the answer of a resume run", () => {
    expect(
      parseAgentRunRequest({ clusterId: "c1", conversationId: "t1", input: { kind: "resume", answer: "yes" } }).input,
    ).toEqual({ kind: "resume", answer: "yes" });
  });

  it.each([
    [undefined, "The request has no JSON body."],
    [{ conversationId: "t1", input: { kind: "message", text: "hi" } }, 'The request has no "clusterId".'],
    [{ clusterId: "c1", input: { kind: "message", text: "hi" } }, 'The request has no "conversationId".'],
    [{ clusterId: "c1", conversationId: "t1" }, "The request has no JSON body."],
    [{ clusterId: "c1", conversationId: "t1", input: { kind: "other" } }, "The run input has an unknown kind."],
    [{ clusterId: "c1", conversationId: "t1", input: { kind: "message", text: "" } }, 'The request has no "text".'],
  ])("refuses %j", (body, message) => {
    expect(() => parseAgentRunRequest(body)).toThrow(message);
  });
});

describe("parseConversationRequest and parseExplainRequest", () => {
  it("read the cluster and the conversation or the text", () => {
    expect(parseConversationRequest({ clusterId: "c1", conversationId: "t1", extra: 1 })).toEqual({
      clusterId: "c1",
      conversationId: "t1",
    });
    expect(parseExplainRequest({ clusterId: "c1", text: "event" })).toEqual({ clusterId: "c1", text: "event" });
    expect(() => parseExplainRequest({ clusterId: "c1" })).toThrow('The request has no "text".');
  });
});

describe("createBridgeRoutes over HTTP", () => {
  const TOKEN = "routes-test-token";
  let bridge: BridgeServer | undefined;

  afterEach(async () => {
    await bridge?.close();
    bridge = undefined;
  });

  // A runtime that answers every run with the cluster and conversation it got.
  const fakeRuntime = () => ({
    run: vi.fn(async function* ({ clusterId, conversationId }: AgentRunRequest, _signal: AbortSignal) {
      yield { type: "text" as const, text: `${clusterId}/${conversationId}` };
    }),
    explain: vi.fn(async function* () {
      yield { type: "text" as const, text: "explained" };
    }),
    compact: vi.fn(async () => ({ summary: "short", contextTokens: 2 })),
    clear: vi.fn(async () => ({})),
    tools: vi.fn(async () => [{ name: "getNamespaces", description: "Get all namespaces" }]),
  });

  const start = async (runtime: ReturnType<typeof fakeRuntime>) => {
    bridge = await startBridgeServer({
      token: TOKEN,
      routes: createBridgeRoutes({
        runtime: runtime as unknown as AgentRuntime,
        fetchModelPricing: async () => ({ "gpt-5.5": { inputCostPerToken: 1, outputCostPerToken: 2 } }),
      }),
    });
    return `http://127.0.0.1:${bridge.port}`;
  };

  const post = (base: string, path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { [BRIDGE_TOKEN_HEADER]: TOKEN, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("routes a run to the cluster and conversation of its request", async () => {
    const runtime = fakeRuntime();
    const base = await start(runtime);

    const responses = await Promise.all(
      ["cluster-a", "cluster-b"].map((clusterId) =>
        post(base, BridgeRoute.run, { clusterId, conversationId: "t1", input: { kind: "message", text: "hi" } }),
      ),
    );
    const events = await Promise.all(
      responses.map(async (response) => {
        const collected: unknown[] = [];
        for await (const event of readSseEvents(response.body as ReadableStream<Uint8Array>)) {
          collected.push(event);
        }
        return collected;
      }),
    );

    expect(events).toEqual([
      [{ type: "text", text: "cluster-a/t1" }, { type: "done" }],
      [{ type: "text", text: "cluster-b/t1" }, { type: "done" }],
    ]);
    expect(runtime.run).toHaveBeenCalledTimes(2);
    expect(runtime.run.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });

  it("refuses a run without a cluster before anything runs", async () => {
    const runtime = fakeRuntime();
    const base = await start(runtime);

    const response = await post(base, BridgeRoute.run, {
      conversationId: "t1",
      input: { kind: "message", text: "hi" },
    });

    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual({ error: 'The request has no "clusterId".' });
    expect(runtime.run).not.toHaveBeenCalled();
  });

  describe("with the agents of a runtime", () => {
    let runtime: AgentRuntime | undefined;

    afterEach(async () => {
      await runtime?.dispose();
      runtime = undefined;
      PreferencesStore.resetInstance();
      AgentStateStore.resetInstance();
    });

    const startRuntime = async () => {
      const agentModel = model();
      runtime = new AgentRuntime(undefined, () => agentModel);
      bridge = await startBridgeServer({
        token: TOKEN,
        routes: createBridgeRoutes({ runtime, fetchModelPricing: async () => ({}) }),
      });
      return `http://127.0.0.1:${bridge.port}`;
    };

    const run = async (base: string, input: AgentRunRequest["input"]) => {
      const response = await post(base, BridgeRoute.run, { clusterId: "c1", conversationId: "t1", input });
      const events: { type: string }[] = [];
      for await (const event of readSseEvents<{ type: string }>(response.body as ReadableStream<Uint8Array>)) {
        events.push(event);
      }
      return events;
    };

    const textOf = (events: { type: string; text?: string }[]) => events.map(({ text }) => text ?? "").join("");

    it("answers a pending approval", async () => {
      const base = await startRuntime();

      expect(await run(base, { kind: "message", text: "list the pods" })).toContainEqual(
        expect.objectContaining({ type: "interrupt" }),
      );
      const resumed = await run(base, { kind: "resume", answer: "yes" });

      expect(textOf(resumed)).toContain('tool saw: The cluster "c1" of this chat is not known to Freelens.');
      expect(resumed.at(-1)).toEqual({ type: "done" });
    });

    it("refuses a resume with no pending approval, after a clear, and runs the next prompt", async () => {
      const base = await startRuntime();
      await run(base, { kind: "message", text: "list the pods" });
      await post(base, BridgeRoute.clear, { clusterId: "c1", conversationId: "t1" });

      expect(await run(base, { kind: "resume", answer: "hello" })).toEqual([
        {
          type: "error",
          error: { message: "There is no pending approval to answer.", code: "no-pending-approval" },
        },
      ]);

      const next = await run(base, { kind: "message", text: "hello" });
      expect(textOf(next)).toContain("answer to: hello");
      expect(next.at(-1)).toEqual({ type: "done" });
    });
  });

  it("answers compact, clear, the tools and the pricing with JSON", async () => {
    const runtime = fakeRuntime();
    const base = await start(runtime);
    const get = (path: string) => fetch(`${base}${path}`, { headers: { [BRIDGE_TOKEN_HEADER]: TOKEN } });

    expect(await (await post(base, BridgeRoute.compact, { clusterId: "c1", conversationId: "t1" })).json()).toEqual({
      summary: "short",
      contextTokens: 2,
    });
    expect(await (await post(base, BridgeRoute.clear, { clusterId: "c1", conversationId: "t1" })).json()).toEqual({});
    expect(runtime.clear).toHaveBeenCalledWith({ clusterId: "c1", conversationId: "t1" });
    expect(await (await get(`${BridgeRoute.tools}?clusterId=c1`)).json()).toEqual({
      tools: [{ name: "getNamespaces", description: "Get all namespaces" }],
    });
    expect(await (await get(BridgeRoute.modelPricing)).json()).toEqual({
      "gpt-5.5": { inputCostPerToken: 1, outputCostPerToken: 2 },
    });
  });
});
