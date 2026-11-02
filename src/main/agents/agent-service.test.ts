import { dynamicTool, jsonSchema } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeKubeJsonApi, installFakeClusters } from "../../../test/kube-json-api";
import {
  finishPart,
  messageText,
  reasoningParts,
  scriptedModel,
  textParts,
  toolCallPart,
  usage,
} from "../../../test/mock-language-model";
import { PreferencesStore } from "../../common/store";
import { type AgentServiceEvent, runAgent } from "./agent-service";
import { buildFreelensAgent, buildMcpAgent } from "./agents";
import { answerApprovals, findPendingApprovals } from "./conversation";

import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import type { ModelMessage, ToolSet } from "ai";

// The Kubernetes operator's case, scripted: the model asks for a patch, and
// once it sees the result of the tool, answers with it. The real tool and its
// approval run in the agent loop of the AI SDK.
const operatorScript = (prompt: LanguageModelV4Prompt) => {
  const last = prompt.at(-1);
  if (last?.role === "tool") {
    return [...textParts(`operator saw: ${messageText(last)}`), finishPart("stop", usage(30, 6))];
  }
  return [
    ...reasoningParts("The user wants three replicas."),
    ...textParts("I will scale it."),
    toolCallPart("patchKubernetesResource", {
      kind: "Deployment",
      name: "web",
      namespace: "default",
      data: { spec: { replicas: 3 } },
    }),
    finishPart("tool-calls", usage(20, 4, 8, 2)),
  ];
};

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
const PROMPT: ModelMessage[] = [{ role: "user", content: "scale web to 3" }];

let clusterA: ReturnType<typeof createFakeKubeJsonApi>;
let clusterB: ReturnType<typeof createFakeKubeJsonApi>;

beforeEach(() => {
  PreferencesStore.resetInstance();
  clusterA = createFakeKubeJsonApi({ "/apis/apps/v1/namespaces/default/deployments/web": WEB });
  clusterB = createFakeKubeJsonApi({ "/apis/apps/v1/namespaces/default/deployments/web": WEB });
  installFakeClusters({ "cluster-a": clusterA, "cluster-b": clusterB });
});

// Runs the Freelens agent on the cluster and returns its events and the
// conversation it stored.
const run = async (clusterId: string, messages: ModelMessage[], signal = new AbortController().signal) => {
  let saved: ModelMessage[] | undefined;
  const events = await collect(
    runAgent({
      agent: buildFreelensAgent(scriptedModel(operatorScript), clusterId),
      messages,
      signal,
      save: (conversation) => {
        saved = conversation;
      },
    }),
  );
  return { events, saved: saved ?? [] };
};

const patches = (cluster: ReturnType<typeof createFakeKubeJsonApi>) =>
  cluster.actions().filter(({ method }) => method === "patch");

describe("runAgent", () => {
  it("stops at the approval of a write and applies it to the run's cluster once approved", async () => {
    const first = await run("cluster-b", PROMPT);

    expect(first.events).toContainEqual({
      type: "interrupt",
      value: expect.objectContaining({
        question: "Do you want to approve this action?",
        options: ["yes", "no"],
        actionToApprove: expect.objectContaining({ action: "PATCH DEPLOYMENT", name: "web" }),
        resourcesString: expect.stringContaining("name: web"),
      }),
    });
    expect(patches(clusterB)).toEqual([]);
    // The approval waits in the stored conversation, also after a restart.
    expect(findPendingApprovals(first.saved)).toMatchObject([{ toolName: "patchKubernetesResource" }]);

    const pending = findPendingApprovals(first.saved);
    const resumed = await run("cluster-b", answerApprovals(first.saved, pending, true));

    expect(resumed.events.some((event) => event.type === "interrupt")).toBe(false);
    expect(textOf(resumed.events)).toContain("operator saw: Deployment patched successfully");
    expect(patches(clusterB)).toEqual([
      expect.objectContaining({
        path: "/apis/apps/v1/namespaces/default/deployments/web",
        data: { spec: { replicas: 3 } },
      }),
    ]);
    expect(clusterA.requests).toEqual([]);
    expect(findPendingApprovals(resumed.saved)).toEqual([]);
  });

  it("applies nothing when the approval is denied, and tells the model", async () => {
    const first = await run("cluster-a", PROMPT);
    const resumed = await run("cluster-a", answerApprovals(first.saved, findPendingApprovals(first.saved), false));

    expect(textOf(resumed.events)).toContain("operator saw: denied: The user denied the action");
    expect(patches(clusterA)).toEqual([]);
  });

  it("streams the reasoning and the text, and reports the usage and the size of the conversation", async () => {
    const { events } = await run("cluster-a", PROMPT);

    expect(events).toContainEqual({ type: "reasoning", reasoning: "The user wants three replicas." });
    expect(textOf(events)).toBe("I will scale it.\n");
    expect(events).toContainEqual({ type: "usage", tokenUsage: { input: 20, cached: 8, output: 4, cacheWrite: 2 } });
    const contextEvents = events.filter((event) => event.type === "context");
    expect(contextEvents.at(-1)).toMatchObject({ type: "context", peakInputTokens: 20 });
    // The input of the call, which carries the instructions and the tool
    // schemas, is what the fixed overhead is measured against.
    expect((contextEvents.at(-1) as { contextTokens: number }).contextTokens).toBeGreaterThanOrEqual(20);
  });

  it("separates the text before a tool call from the answer after it", async () => {
    const first = await run("cluster-a", PROMPT);
    const resumed = await run("cluster-a", answerApprovals(first.saved, findPendingApprovals(first.saved), true));

    expect(textOf(resumed.events)).toBe("operator saw: Deployment patched successfully\n");

    const loop = await collect(
      runAgent({
        agent: buildFreelensAgent(
          scriptedModel((prompt) =>
            prompt.at(-1)?.role === "tool"
              ? [...textParts("default"), finishPart("stop")]
              : [...textParts("Looking."), toolCallPart("getNamespaces", {}), finishPart("tool-calls")],
          ),
          "cluster-a",
        ),
        messages: PROMPT,
        signal: new AbortController().signal,
        save: vi.fn(),
      }),
    );
    expect(textOf(loop)).toBe("Looking.\n\ndefault\n");
  });

  it("ends with an explanation when the model calls a tool that does not exist", async () => {
    const agent = buildFreelensAgent(
      scriptedModel(() => [toolCallPart("runCommand", { command: "kubectl get pods" }), finishPart("tool-calls")]),
      "cluster-a",
    );
    const save = vi.fn();

    await expect(
      collect(runAgent({ agent, messages: PROMPT, signal: new AbortController().signal, save })),
    ).rejects.toThrow("The model tried to use an unsupported tool (`runCommand`).");
    expect(save).not.toHaveBeenCalled();
  });

  it("does not run and stores nothing when its signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const save = vi.fn();

    await expect(
      collect(
        runAgent({
          agent: buildFreelensAgent(scriptedModel(operatorScript), "cluster-a"),
          messages: PROMPT,
          signal: controller.signal,
          save,
        }),
      ),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    expect(clusterA.requests).toEqual([]);
  });

  it("asks for the approval of every MCP tool call, with its input", async () => {
    const execute = vi.fn(async () => "pods: web-1");
    // A tool as the MCP client of the AI SDK makes it: dynamic, with the JSON
    // schema of its server.
    const tools: ToolSet = {
      pods_list: dynamicTool({ description: "List pods", inputSchema: jsonSchema({ type: "object" }), execute }),
    };
    const agent = buildMcpAgent(
      scriptedModel(() => [toolCallPart("pods_list", { namespace: "default" }), finishPart("tool-calls")]),
      tools,
    );

    const events = await collect(
      runAgent({ agent, messages: PROMPT, signal: new AbortController().signal, save: vi.fn() }),
    );

    expect(events).toContainEqual({
      type: "interrupt",
      value: expect.objectContaining({
        question: "The agent has requested to use a tool",
        actionToApprove: { action: ["pods_list"] },
        actionString: expect.stringContaining("namespace: default"),
        requestString: "The agent wants to use this tool: pods_list",
      }),
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
