import { Common, Main } from "@freelensapp/extensions";
import { observable, runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStateStore, PreferencesStore } from "../../common/store";
import { McpClients } from "../mcp/mcp-clients";
import { AgentRuntime } from "./agent-runtime";
import { useFreeLensAgentSystem } from "./freelens-agent-system";

import type { StructuredToolInterface } from "@langchain/core/tools";

import type { AgentRunRequest } from "../../common/bridge/protocol";
import type { AgentServiceEvent } from "./agent-service";

// The graphs are replaced by stand-ins named after the cluster they were built
// for, and the service by one that reports which agent ran, so the tests see
// how the runtime picks the agent of a request.
vi.mock("./freelens-agent-system", () => {
  const buildAgentSystem = vi.fn((clusterId: string) => ({
    name: `freelens:${clusterId}`,
    // The conversation "pending" waits on an approval.
    getState: async ({ configurable }: { configurable: { thread_id: string } }) => ({
      values: { messages: [] },
      tasks: configurable.thread_id === "pending" ? [{ name: "tools", interrupts: [{ value: "approve?" }] }] : [],
    }),
    updateState: async () => undefined,
  }));
  return {
    useFreeLensAgentSystem: () => ({ buildAgentSystem, availableTools: [{ name: "getNamespaces", description: "d" }] }),
  };
});

vi.mock("./mcp-agent", () => {
  const buildAgentSystem = vi.fn((clusterId: string, tools: StructuredToolInterface[]) => ({
    name: `mcp:${clusterId}:${tools.map(({ name }) => name).join(",")}`,
    getState: async () => ({ values: { messages: [] }, tasks: [] }),
    updateState: async () => undefined,
  }));
  return { useMcpAgent: () => ({ buildAgentSystem }) };
});

vi.mock("./agent-service", () => ({
  useAgentService: (agent: { name: string }) => ({
    run: async function* (
      _input: unknown,
      { clusterId, conversationId }: { clusterId: string; conversationId: string },
    ) {
      if (conversationId === "failing") {
        throw Object.assign(new Error("Internal error"), { status: 502 });
      }
      yield { type: "text", text: `${agent.name} ran ${clusterId}/${conversationId}` } satisfies AgentServiceEvent;
    },
  }),
}));

const collect = async (events: AsyncIterable<unknown>) => {
  const collected: unknown[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
};

const request = (clusterId: string, conversationId = "t1"): AgentRunRequest => ({
  clusterId,
  conversationId,
  input: { kind: "message", text: "hi" },
});

const preferences = () => PreferencesStore.getInstanceOrCreate<PreferencesStore>();

type ClusterInfo = ReturnType<typeof Main.Catalog.getAllClusters>[number];

// The part of a catalog cluster the runtime reads.
const cluster = (id: string, status: Common.Clusters.ClusterConnectionStatus) => ({ id, status }) as ClusterInfo;

// MCP clients whose tools are named after the cluster and the number of the
// start, and which record what the runtime stops.
const fakeMcpClients = () => {
  let starts = 0;
  const tools = new Map<string, StructuredToolInterface[]>();
  const mcpClients = new McpClients();
  vi.spyOn(mcpClients, "getTools").mockImplementation(async (clusterId: string) => {
    let current = tools.get(clusterId);
    if (!current) {
      starts += 1;
      current = [{ name: `${clusterId}-tool-${starts}`, description: "an MCP tool" } as StructuredToolInterface];
      tools.set(clusterId, current);
    }
    return current;
  });
  vi.spyOn(mcpClients, "closeAll").mockImplementation(async () => tools.clear());
  vi.spyOn(mcpClients, "closeDisconnected").mockResolvedValue();
  return { mcpClients, stop: (clusterId: string) => tools.delete(clusterId) };
};

let runtimes: AgentRuntime[] = [];

const createRuntime = (mcpClients?: McpClients) => {
  const runtime = new AgentRuntime(mcpClients);
  runtimes.push(runtime);
  return runtime;
};

beforeEach(() => {
  PreferencesStore.resetInstance();
  AgentStateStore.resetInstance();
  vi.mocked(useFreeLensAgentSystem().buildAgentSystem).mockClear();
  vi.mocked(Main.Catalog.getAllClusters).mockReset().mockReturnValue([]);
});

afterEach(async () => {
  for (const runtime of runtimes) {
    await runtime.dispose();
  }
  runtimes = [];
});

describe("AgentRuntime", () => {
  it("builds one agent per cluster and keeps it for the next run", async () => {
    const runtime = createRuntime();
    const signal = new AbortController().signal;

    expect(await collect(runtime.run(request("cluster-a"), signal))).toEqual([
      { type: "text", text: "freelens:cluster-a ran cluster-a/t1" },
    ]);
    expect(await collect(runtime.run(request("cluster-b"), signal))).toEqual([
      { type: "text", text: "freelens:cluster-b ran cluster-b/t1" },
    ]);
    await collect(runtime.run(request("cluster-a", "t2"), signal));

    expect(vi.mocked(useFreeLensAgentSystem().buildAgentSystem).mock.calls).toEqual([["cluster-a"], ["cluster-b"]]);
  });

  it("turns an endpoint error into the message the chat shows", async () => {
    preferences().openAIBaseUrl = "http://litellm.local:4000";
    const runtime = createRuntime();

    await expect(collect(runtime.run(request("cluster-a", "failing"), new AbortController().signal))).rejects.toThrow(
      "The AI endpoint http://litellm.local:4000 answered with a server error.",
    );
  });

  it("resumes a conversation that waits on an approval", async () => {
    const runtime = createRuntime();
    const resume: AgentRunRequest = {
      clusterId: "cluster-a",
      conversationId: "pending",
      input: { kind: "resume", answer: "yes" },
    };

    expect(await collect(runtime.run(resume, new AbortController().signal))).toEqual([
      { type: "text", text: "freelens:cluster-a ran cluster-a/pending" },
    ]);
  });

  it("refuses a resume of a conversation with no pending approval, and runs nothing", async () => {
    const runtime = createRuntime();
    const resume: AgentRunRequest = {
      clusterId: "cluster-a",
      conversationId: "t1",
      input: { kind: "resume", answer: "yes" },
    };

    const refused = collect(runtime.run(resume, new AbortController().signal));

    await expect(refused).rejects.toThrow("There is no pending approval to answer.");
    await expect(refused).rejects.toMatchObject({ code: "no-pending-approval" });
  });

  it("clears the stored memory of the cluster only", async () => {
    const store = AgentStateStore.getInstanceOrCreate<AgentStateStore>();
    store.setCheckpoint("cluster-a::freelens", "a");
    store.setCheckpoint("cluster-b::freelens", "b");
    const runtime = createRuntime();
    await collect(runtime.run(request("cluster-a"), new AbortController().signal));

    expect(await runtime.clear({ clusterId: "cluster-a", conversationId: "t1" })).toEqual({});

    expect(store.checkpoints).toEqual({ "cluster-b::freelens": "b" });
  });

  it("lists the Kubernetes tools when MCP is off", async () => {
    expect(await createRuntime().tools("cluster-a")).toEqual([{ name: "getNamespaces", description: "d" }]);
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

    expect(await collect(runtime.run(request("cluster-a"), signal))).toEqual([
      { type: "text", text: "mcp:cluster-a:cluster-a-tool-1 ran cluster-a/t1" },
    ]);
    expect(await collect(runtime.run(request("cluster-b"), signal))).toEqual([
      { type: "text", text: "mcp:cluster-b:cluster-b-tool-2 ran cluster-b/t1" },
    ]);
    expect(await runtime.tools("cluster-a")).toEqual([{ name: "cluster-a-tool-1", description: "an MCP tool" }]);
    expect(mcpClients.getTools).toHaveBeenCalledWith("cluster-a", preferences().mcpConfiguration);
  });

  it("rebuilds the agent when the cluster's servers were started again", async () => {
    const { mcpClients, stop } = fakeMcpClients();
    const runtime = createRuntime(mcpClients);
    const signal = new AbortController().signal;
    await collect(runtime.run(request("cluster-a"), signal));

    stop("cluster-a");

    expect(await collect(runtime.run(request("cluster-a"), signal))).toEqual([
      { type: "text", text: "mcp:cluster-a:cluster-a-tool-2 ran cluster-a/t1" },
    ]);
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
