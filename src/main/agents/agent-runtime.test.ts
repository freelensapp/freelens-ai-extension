import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStateStore, PreferencesStore } from "../../common/store";
import { AgentRuntime } from "./agent-runtime";
import { useFreeLensAgentSystem } from "./freelens-agent-system";

import type { AgentRunRequest } from "../../common/bridge/protocol";
import type { AgentServiceEvent } from "./agent-service";

// The graphs are replaced by stand-ins named after the cluster they were built
// for, and the service by one that reports which agent ran, so the tests see
// how the runtime picks the agent of a request.
vi.mock("./freelens-agent-system", () => {
  const buildAgentSystem = vi.fn((clusterId: string) => ({
    name: `freelens:${clusterId}`,
    getState: async () => ({ values: { messages: [] } }),
    updateState: async () => undefined,
  }));
  return {
    useFreeLensAgentSystem: () => ({ buildAgentSystem, availableTools: [{ name: "getNamespaces", description: "d" }] }),
  };
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

beforeEach(() => {
  PreferencesStore.resetInstance();
  AgentStateStore.resetInstance();
  vi.mocked(useFreeLensAgentSystem().buildAgentSystem).mockClear();
});

describe("AgentRuntime", () => {
  it("builds one agent per cluster and keeps it for the next run", async () => {
    const runtime = new AgentRuntime();
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
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().openAIBaseUrl = "http://litellm.local:4000";
    const runtime = new AgentRuntime();

    await expect(collect(runtime.run(request("cluster-a", "failing"), new AbortController().signal))).rejects.toThrow(
      "The AI endpoint http://litellm.local:4000 answered with a server error.",
    );
  });

  it("clears the stored memory of the cluster only", async () => {
    const store = AgentStateStore.getInstanceOrCreate<AgentStateStore>();
    store.setCheckpoint("cluster-a::freelens", "a");
    store.setCheckpoint("cluster-b::freelens", "b");
    const runtime = new AgentRuntime();
    await collect(runtime.run(request("cluster-a"), new AbortController().signal));

    expect(await runtime.clear({ clusterId: "cluster-a", conversationId: "t1" })).toEqual({});

    expect(store.checkpoints).toEqual({ "cluster-b::freelens": "b" });
  });

  it("lists the Kubernetes tools when MCP is off", async () => {
    expect(await new AgentRuntime().tools("cluster-a")).toEqual([{ name: "getNamespaces", description: "d" }]);
  });
});
