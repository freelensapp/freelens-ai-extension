import { Common, Main } from "@freelensapp/extensions";
import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { observable, runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeKubeJsonApi, installFakeClusters } from "../../../test/kube-json-api";
import { finishPart, messageText, scriptedModel, textParts, toolCallPart } from "../../../test/mock-language-model";
import { AgentStateStore, PreferencesStore } from "../../common/store";
import { McpClients } from "../mcp/mcp-clients";
import { AgentRuntime } from "./agent-runtime";

import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import type { LanguageModel, ModelMessage } from "ai";

import type { AgentRunRequest } from "../../common/bridge/protocol";
import type { AgentStateModel } from "../../common/store/agent-state-store";

const collect = async (events: AsyncIterable<unknown>) => {
  const collected: unknown[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
};

const textOf = (events: unknown[]) =>
  (events as { type: string; text?: string }[]).map(({ text }) => text ?? "").join("");

const request = (clusterId: string, text = "hi", conversationId = "t1"): AgentRunRequest => ({
  clusterId,
  conversationId,
  input: { kind: "message", text },
});

const resume = (clusterId: string, answer: string, conversationId = "t1"): AgentRunRequest => ({
  clusterId,
  conversationId,
  input: { kind: "resume", answer },
});

// A model that answers with the last prompt and the tools it was offered, and
// asks for a namespace delete when the prompt says "delete".
const echoScript = (prompt: LanguageModelV4Prompt, { tools }: { tools?: { name: string }[] }) => {
  const last = prompt.at(-1);
  if (last?.role === "user" && messageText(last).includes("delete")) {
    return [toolCallPart("deleteKubernetesResource", { kind: "Namespace", name: "old" }), finishPart("tool-calls")];
  }
  const toolNames = (tools ?? []).map(({ name }) => name).join(",");
  return [...textParts(`${last?.role}: ${messageText(last)} [${toolNames.slice(0, 40)}]`), finishPart("stop")];
};

const preferences = () => PreferencesStore.getInstanceOrCreate<PreferencesStore>();
const store = () => AgentStateStore.getInstanceOrCreate<AgentStateStore>();
const conversation = (namespace: string, conversationId = "t1") =>
  store().getConversation(namespace, conversationId) as unknown as ModelMessage[];

type ClusterInfo = ReturnType<typeof Main.Catalog.getAllClusters>[number];

// The part of a catalog cluster the runtime reads.
const cluster = (id: string, status: Common.Clusters.ClusterConnectionStatus) => ({ id, status }) as ClusterInfo;

// MCP clients whose tools are named after the cluster and the number of the
// start, and which record what the runtime stops.
const fakeMcpClients = () => {
  let starts = 0;
  const tools = new Map<string, ToolSet>();
  const mcpClients = new McpClients();
  vi.spyOn(mcpClients, "getTools").mockImplementation(async (clusterId: string) => {
    let current = tools.get(clusterId);
    if (!current) {
      starts += 1;
      current = {
        [`${clusterId}-tool-${starts}`]: dynamicTool({
          description: "an MCP tool",
          inputSchema: jsonSchema({ type: "object" }),
          execute: async () => "done",
        }),
      };
      tools.set(clusterId, current);
    }
    return current;
  });
  vi.spyOn(mcpClients, "closeAll").mockImplementation(async () => tools.clear());
  vi.spyOn(mcpClients, "closeDisconnected").mockResolvedValue();
  return { mcpClients, stop: (clusterId: string) => tools.delete(clusterId) };
};

let runtimes: AgentRuntime[] = [];

const createRuntime = (mcpClients?: McpClients, model: LanguageModel = scriptedModel(echoScript)) => {
  const runtime = new AgentRuntime(mcpClients, () => model);
  runtimes.push(runtime);
  return runtime;
};

beforeEach(() => {
  PreferencesStore.resetInstance();
  AgentStateStore.resetInstance();
  vi.mocked(Main.Catalog.getAllClusters).mockReset().mockReturnValue([]);
  installFakeClusters({
    "cluster-a": createFakeKubeJsonApi({ "/api/v1/namespaces/old": { metadata: { name: "old" } } }),
    "cluster-b": createFakeKubeJsonApi(),
  });
});

afterEach(async () => {
  for (const runtime of runtimes) {
    await runtime.dispose();
  }
  runtimes = [];
});

describe("AgentRuntime", () => {
  it("runs the agent on the request's cluster and keeps each cluster's conversation apart", async () => {
    const runtime = createRuntime();
    const signal = new AbortController().signal;

    expect(textOf(await collect(runtime.run(request("cluster-a", "first"), signal)))).toContain("user: first");
    expect(textOf(await collect(runtime.run(request("cluster-b", "other"), signal)))).toContain("user: other");
    expect(textOf(await collect(runtime.run(request("cluster-a", "second"), signal)))).toContain("user: second");

    expect(conversation("cluster-a::freelens").map(({ role }) => role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(conversation("cluster-b::freelens")).toHaveLength(2);
  });

  it("seeds the summary of a just compacted session before the prompt", async () => {
    const runtime = createRuntime();

    await collect(
      runtime.run(
        { clusterId: "cluster-a", conversationId: "t1", input: { kind: "message", text: "next", summary: "earlier" } },
        new AbortController().signal,
      ),
    );

    expect(conversation("cluster-a::freelens").slice(0, 2)).toEqual([
      { role: "user", content: "Summary of the earlier (compacted) conversation:\nearlier" },
      { role: "user", content: "next" },
    ]);
  });

  it("turns an endpoint error into the message the chat shows", async () => {
    preferences().openAIBaseUrl = "http://litellm.local:4000";
    const failing = new MockLanguageModelV4({
      doStream: async () => {
        throw Object.assign(new Error("Internal error"), { statusCode: 502 });
      },
    });
    const runtime = createRuntime(undefined, failing);

    await expect(collect(runtime.run(request("cluster-a"), new AbortController().signal))).rejects.toThrow(
      "The AI endpoint http://litellm.local:4000 answered with a server error.",
    );
  });

  it("resumes a conversation that waits on an approval, from its stored messages", async () => {
    const runtime = createRuntime();
    const signal = new AbortController().signal;

    const first = await collect(runtime.run(request("cluster-a", "delete the namespace old"), signal));
    expect(first).toContainEqual(expect.objectContaining({ type: "interrupt" }));

    // A new runtime, as after a restart, reads the approval from the store.
    const restarted = createRuntime();
    const resumed = await collect(restarted.run(resume("cluster-a", "no"), signal));

    expect(textOf(resumed)).toContain("tool: denied: The user denied the action");
  });

  it("refuses a resume of a conversation with no pending approval, and runs nothing", async () => {
    const model = scriptedModel(echoScript);
    const runtime = createRuntime(undefined, model);

    const refused = collect(runtime.run(resume("cluster-a", "yes"), new AbortController().signal));

    await expect(refused).rejects.toThrow("There is no pending approval to answer.");
    await expect(refused).rejects.toMatchObject({ code: "no-pending-approval" });
    expect(model.doStreamCalls).toEqual([]);
  });

  it("denies a pending approval when a new prompt comes instead of an answer", async () => {
    const runtime = createRuntime();
    const signal = new AbortController().signal;
    await collect(runtime.run(request("cluster-a", "delete the namespace old"), signal));

    await collect(runtime.run(request("cluster-a", "never mind"), signal));

    const messages = conversation("cluster-a::freelens");
    expect(messages.map(({ role }) => role)).toEqual(["user", "assistant", "tool", "user", "assistant"]);
    expect(messages[2]?.content).toContainEqual(
      expect.objectContaining({ type: "tool-result", output: expect.objectContaining({ type: "execution-denied" }) }),
    );
  });

  it("keeps the last five turns of the conversation", async () => {
    const runtime = createRuntime();
    const signal = new AbortController().signal;
    for (const turn of [1, 2, 3, 4, 5, 6, 7]) {
      await collect(runtime.run(request("cluster-a", `turn ${turn}`), signal));
    }

    const prompts = conversation("cluster-a::freelens").filter(({ role }) => role === "user");
    expect(prompts.map(({ content }) => content)).toEqual(["turn 3", "turn 4", "turn 5", "turn 6", "turn 7"]);
  });

  it("clears the stored memory of the cluster only", async () => {
    store().setConversation("cluster-a::freelens", "t1", [{ role: "user", content: "a" }]);
    store().setConversation("cluster-a::mcp", "t1", [{ role: "user", content: "a" }]);
    store().setConversation("cluster-b::freelens", "t1", [{ role: "user", content: "b" }]);
    const runtime = createRuntime();

    expect(await runtime.clear({ clusterId: "cluster-a", conversationId: "t1" })).toEqual({});

    expect(store().conversations).toEqual({ "cluster-b::freelens": { t1: [{ role: "user", content: "b" }] } });
  });

  it("drops the LangGraph checkpoints of an earlier version without an error", () => {
    store().fromStore({ checkpoints: { "cluster-a::freelens": "serialized" } } as unknown as AgentStateModel);

    expect(store().conversations).toEqual({});
    expect(store().toJSON()).toEqual({ conversations: {} });
  });

  it("compacts a conversation into a summary and replaces it", async () => {
    store().setConversation("cluster-a::freelens", "t1", [{ role: "user", content: "list the pods" }]);
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: " three pods " }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      },
    });

    const compacted = await createRuntime(undefined, model).compact({ clusterId: "cluster-a", conversationId: "t1" });

    expect(compacted).toEqual({ summary: "three pods", contextTokens: 3 });
    expect(conversation("cluster-a::freelens")).toEqual([]);
  });

  it("lists the Kubernetes tools when MCP is off", async () => {
    const tools = await createRuntime().tools("cluster-a");

    expect(tools.map(({ name }) => name)).toContain("getNamespaces");
    expect(tools.find(({ name }) => name === "getNamespaces")?.description).toBe(
      "Get all namespaces of the Kubernetes cluster",
    );
  });
});

describe("AgentRuntime with MCP", () => {
  beforeEach(() => {
    preferences().mcpEnabled = true;
  });

  it("runs the MCP agent of the cluster with the tools of the cluster's servers", async () => {
    const { mcpClients } = fakeMcpClients();
    const runtime = createRuntime(mcpClients);
    const signal = new AbortController().signal;

    expect(textOf(await collect(runtime.run(request("cluster-a"), signal)))).toContain("[cluster-a-tool-1]");
    expect(textOf(await collect(runtime.run(request("cluster-b"), signal)))).toContain("[cluster-b-tool-2]");
    expect(await runtime.tools("cluster-a")).toEqual([{ name: "cluster-a-tool-1", description: "an MCP tool" }]);
    expect(mcpClients.getTools).toHaveBeenCalledWith("cluster-a", preferences().mcpConfiguration);
    // The MCP agent keeps a conversation of its own.
    expect(conversation("cluster-a::mcp")).toHaveLength(2);
    expect(conversation("cluster-a::freelens")).toEqual([]);
  });

  it("runs with the tools of the servers that run now, after they were started again", async () => {
    const { mcpClients, stop } = fakeMcpClients();
    const runtime = createRuntime(mcpClients);
    const signal = new AbortController().signal;
    await collect(runtime.run(request("cluster-a"), signal));

    stop("cluster-a");

    expect(textOf(await collect(runtime.run(request("cluster-a"), signal)))).toContain("[cluster-a-tool-2]");
  });

  it("stops every server when MCP is turned off or its configuration changes", async () => {
    const { mcpClients } = fakeMcpClients();
    createRuntime(mcpClients);

    runInAction(() => {
      preferences().mcpConfiguration = JSON.stringify({ mcpServers: { other: { command: "other" } } });
    });
    expect(mcpClients.closeAll).toHaveBeenCalledTimes(1);

    runInAction(() => {
      preferences().mcpEnabled = false;
    });
    expect(mcpClients.closeAll).toHaveBeenCalledTimes(2);
  });

  it("stops the servers of a cluster when its connection status changes", async () => {
    const clusters = observable.array([cluster("cluster-a", Common.Clusters.ClusterConnectionStatus.CONNECTED)]);
    vi.mocked(Main.Catalog.getAllClusters).mockImplementation(() => clusters.slice());
    const { mcpClients } = fakeMcpClients();
    createRuntime(mcpClients);

    runInAction(() => {
      clusters[0] = cluster("cluster-a", Common.Clusters.ClusterConnectionStatus.DISCONNECTED);
    });

    expect(mcpClients.closeDisconnected).toHaveBeenCalledOnce();
  });

  it("stops every server and follows no change after dispose", async () => {
    const { mcpClients } = fakeMcpClients();
    const runtime = createRuntime(mcpClients);

    await runtime.dispose();
    runInAction(() => {
      preferences().mcpEnabled = false;
    });

    expect(mcpClients.closeAll).toHaveBeenCalledOnce();
  });
});
