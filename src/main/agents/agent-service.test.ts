import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { Command, MemorySaver, MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeKubeJsonApi, installFakeClusters } from "../../../test/kube-json-api";
import { type AgentServiceEvent, useAgentService } from "./agent-service";
import { patchKubernetesResource } from "./tools/tools";

import type { FreeLensAgent } from "./freelens-agent-system";

// The Kubernetes operator reduced to its structure: a node that asks for a
// patch, the real tool behind a ToolNode, and a checkpointer, so the run goes
// through LangGraph's `interrupt()` with main's AsyncLocalStorage, as the
// agents do. The tool loads the backup YAML before it asks for approval, which
// is the case that needs the run context to survive an `await`.
const buildOperator = () =>
  new StateGraph(MessagesAnnotation)
    .addNode("agent", (state) => {
      const last = state.messages[state.messages.length - 1];
      if (ToolMessage.isInstance(last)) {
        return { messages: [new AIMessage(`operator saw: ${last.content}`)] };
      }
      return {
        messages: [
          new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "call-1",
                name: "patchKubernetesResource",
                args: { kind: "Deployment", name: "web", namespace: "default", data: { spec: { replicas: 3 } } },
              },
            ],
          }),
        ],
      };
    })
    .addNode("tools", new ToolNode([patchKubernetesResource]))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", (state) => {
      const last = state.messages[state.messages.length - 1] as AIMessage;
      return last.tool_calls?.length ? "tools" : "__end__";
    })
    .addEdge("tools", "agent")
    .compile({ checkpointer: new MemorySaver() });

const collect = async (events: AsyncGenerator<AgentServiceEvent>) => {
  const collected: AgentServiceEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
};

const textOf = (events: AgentServiceEvent[]) =>
  events.flatMap((event) => (event.type === "text" ? [event.text] : [])).join("");

const WEB = { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "web", namespace: "default" } };

let clusterA: ReturnType<typeof createFakeKubeJsonApi>;
let clusterB: ReturnType<typeof createFakeKubeJsonApi>;

beforeEach(() => {
  clusterA = createFakeKubeJsonApi({ "/apis/apps/v1/namespaces/default/deployments/web": WEB });
  clusterB = createFakeKubeJsonApi({ "/apis/apps/v1/namespaces/default/deployments/web": WEB });
  installFakeClusters({ "cluster-a": clusterA, "cluster-b": clusterB });
});

describe("useAgentService", () => {
  it("stops at the approval of a write and applies it to the run's cluster once approved", async () => {
    const service = useAgentService(buildOperator() as unknown as FreeLensAgent);
    const context = { clusterId: "cluster-b", conversationId: "conversation-1", signal: new AbortController().signal };

    const first = await collect(service.run({ messages: [new HumanMessage("scale web to 3")] }, context));

    expect(first).toContainEqual({
      type: "interrupt",
      value: expect.objectContaining({
        question: "Do you want to approve this action?",
        options: ["yes", "no"],
        actionToApprove: expect.objectContaining({ action: "PATCH DEPLOYMENT", name: "web" }),
        resourcesString: expect.stringContaining("name: web"),
      }),
    });
    expect(clusterB.actions().some(({ method }) => method === "patch")).toBe(false);

    const resumed = await collect(service.run(new Command({ resume: "yes" }), context));

    expect(resumed.some((event) => event.type === "interrupt")).toBe(false);
    expect(textOf(resumed)).toContain("operator saw: Deployment patched successfully");
    expect(clusterB.actions().filter(({ method }) => method === "patch")).toEqual([
      expect.objectContaining({
        path: "/apis/apps/v1/namespaces/default/deployments/web",
        data: { spec: { replicas: 3 } },
      }),
    ]);
    expect(clusterA.requests).toEqual([]);
  });

  it("applies nothing when the approval is denied", async () => {
    const service = useAgentService(buildOperator() as unknown as FreeLensAgent);
    const context = { clusterId: "cluster-a", conversationId: "conversation-2", signal: new AbortController().signal };

    await collect(service.run({ messages: [new HumanMessage("scale web to 3")] }, context));
    const resumed = await collect(service.run(new Command({ resume: "no" }), context));

    expect(textOf(resumed)).toContain("operator saw: The user denied the action");
    expect(clusterA.actions().some(({ method }) => method === "patch")).toBe(false);
  });

  it("reports the size of the persisted conversation", async () => {
    const service = useAgentService(buildOperator() as unknown as FreeLensAgent);
    const context = { clusterId: "cluster-a", conversationId: "conversation-3", signal: new AbortController().signal };

    const events = await collect(service.run({ messages: [new HumanMessage("scale web to 3")] }, context));

    const contextEvents = events.filter((event) => event.type === "context");
    expect(contextEvents.at(-1)).toMatchObject({ type: "context", peakInputTokens: 0 });
    expect((contextEvents.at(-1) as { contextTokens: number }).contextTokens).toBeGreaterThan(0);
  });

  it("does not run when its signal is already aborted", async () => {
    const service = useAgentService(buildOperator() as unknown as FreeLensAgent);
    const controller = new AbortController();
    controller.abort();

    await expect(
      collect(
        service.run(
          { messages: [new HumanMessage("scale web to 3")] },
          { clusterId: "cluster-a", conversationId: "conversation-4", signal: controller.signal },
        ),
      ),
    ).rejects.toThrow();
    expect(clusterA.requests).toEqual([]);
  });
});
