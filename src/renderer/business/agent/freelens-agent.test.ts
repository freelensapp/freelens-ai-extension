import { Model, tool } from "@strands-agents/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type AgentChunk, isApprovalChunk, useAgentService } from "../service/agent-service";
import { createFreelensAgent, resetConversation } from "./freelens-agent";
import { type KeyValueBackend, KeyValueSessionStorage } from "./session-storage";
import { DENIED_ACTION_MESSAGE, requestApproval } from "./tools/approval";

import type { BaseModelConfig, Message, ModelStreamEvent } from "@strands-agents/sdk";

// A model that replays scripted turns and records the conversation it was sent.
class ScriptedModel extends Model {
  readonly requests: Message[][] = [];
  private config: BaseModelConfig = { modelId: "scripted" };

  constructor(private readonly turns: ModelStreamEvent[][]) {
    super();
  }

  updateConfig(modelConfig: BaseModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  getConfig(): BaseModelConfig {
    return this.config;
  }

  async *stream(messages: Message[]): AsyncIterable<ModelStreamEvent> {
    this.requests.push(messages.map((message) => message));
    const turn = this.turns.shift();
    if (!turn) {
      throw new Error("No scripted turn left");
    }
    yield* turn;
  }
}

const usage = (inputTokens: number, outputTokens: number): ModelStreamEvent => ({
  type: "modelMetadataEvent",
  usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
});

const toolUseTurn = (name: string, toolUseId: string, input: object): ModelStreamEvent[] => [
  { type: "modelMessageStartEvent", role: "assistant" },
  { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name, toolUseId } },
  { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(input) } },
  { type: "modelContentBlockStopEvent" },
  { type: "modelMessageStopEvent", stopReason: "toolUse" },
  usage(100, 10),
];

const textTurn = (text: string): ModelStreamEvent[] => [
  { type: "modelMessageStartEvent", role: "assistant" },
  { type: "modelContentBlockStartEvent" },
  { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text } },
  { type: "modelContentBlockStopEvent" },
  { type: "modelMessageStopEvent", stopReason: "endTurn" },
  usage(120, 20),
];

class MemoryBackend implements KeyValueBackend {
  readonly entries = new Map<string, string>();
  getEntry = (key: string) => this.entries.get(key);
  setEntry = (key: string, value: string) => void this.entries.set(key, value);
  deleteEntry = (key: string) => void this.entries.delete(key);
  entryKeys = () => [...this.entries.keys()];
}

const setup = (turns: ModelStreamEvent[][], backend = new MemoryBackend(), mcp = false) => {
  const executed: string[] = [];
  const deleteThing = tool({
    name: "deleteThing",
    description: "Delete a thing",
    inputSchema: z.object({ name: z.string() }),
    callback: (input, context) => {
      if (!requestApproval(context, "DELETE THING", { name: input.name })) {
        return DENIED_ACTION_MESSAGE;
      }
      executed.push(input.name);
      return `deleted ${input.name}`;
    },
  });
  const mcpTool = tool({
    name: "mcpEcho",
    description: "An MCP tool",
    inputSchema: z.object({}),
    callback: () => {
      executed.push("mcpEcho");
      return "echo";
    },
  });
  const model = new ScriptedModel(turns);
  const agent = createFreelensAgent({
    model,
    systemPrompt: "You are a test agent.",
    tools: [deleteThing],
    mcpTools: mcp ? [mcpTool] : [],
    storage: new KeyValueSessionStorage(backend),
    sessionId: "cluster-a__conversation-1",
  });
  const service = useAgentService(agent, () => model);
  return { agent, model, service, executed, backend };
};

const collect = async (stream: AsyncIterable<AgentChunk>): Promise<AgentChunk[]> => {
  const chunks: AgentChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
};

const textOf = (chunks: AgentChunk[]) => chunks.filter((chunk) => typeof chunk === "string").join("");

// The text of the tool results the model was sent in its last request.
const lastToolResults = (model: ScriptedModel): string[] =>
  (model.requests.at(-1) ?? [])
    .flatMap((message) => message.content)
    .filter((block) => block.type === "toolResultBlock")
    .flatMap((block) => (block.type === "toolResultBlock" ? block.content : []))
    .map((content) => ("text" in content ? content.text : JSON.stringify(content)));

describe("Freelens agent loop", () => {
  it("streams text, usage and context size for a plain answer", async () => {
    const { service } = setup([textTurn("Hello!")]);
    const chunks = await collect(service.run({ kind: "message", text: "hi" }));
    expect(textOf(chunks)).toBe("Hello!");
    expect(chunks).toContainEqual({ tokenUsage: { input: 120, cached: 0, output: 20 } });
    expect(chunks).toContainEqual({ contextTokens: 140, peakInputTokens: 120 });
  });

  it("pauses a write tool for approval and runs it once approved", async () => {
    const { service, executed, model } = setup([
      [
        { type: "modelMessageStartEvent", role: "assistant" },
        { type: "modelContentBlockStartEvent" },
        { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: "I will delete it." } },
        { type: "modelContentBlockStopEvent" },
        ...toolUseTurn("deleteThing", "tool-1", { name: "pod-a" }).slice(1),
      ],
      textTurn("Done."),
    ]);

    const first = await collect(service.run({ kind: "message", text: "delete pod-a" }));
    const approvals = first.filter(isApprovalChunk);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].approval.actionToApprove).toEqual({ action: "DELETE THING", name: "pod-a" });
    expect(approvals[0].approval.options).toEqual(["yes", "no"]);
    expect(approvals[0].approval.actionString).toContain("action: DELETE THING");
    expect(executed).toEqual([]);

    const second = await collect(service.run({ kind: "resume", answer: "yes" }));
    expect(executed).toEqual(["pod-a"]);
    expect(lastToolResults(model)).toEqual(["deleted pod-a"]);
    // The preamble and the final answer are separate assistant messages.
    expect(textOf(first)).toBe("I will delete it.");
    expect(textOf(second)).toBe("Done.");
  });

  it("reports the denial to the model when the approval is rejected", async () => {
    const { service, executed, model } = setup([
      toolUseTurn("deleteThing", "tool-1", { name: "pod-a" }),
      textTurn("Understood, nothing was deleted."),
    ]);

    await collect(service.run({ kind: "message", text: "delete pod-a" }));
    await collect(service.run({ kind: "resume", answer: "no" }));

    expect(executed).toEqual([]);
    expect(lastToolResults(model)).toEqual([DENIED_ACTION_MESSAGE]);
  });

  it("restores the conversation and the pending approval after a restart", async () => {
    const backend = new MemoryBackend();
    const before = setup([toolUseTurn("deleteThing", "tool-1", { name: "pod-a" })], backend);
    await collect(before.service.run({ kind: "message", text: "delete pod-a" }));
    expect(backend.entryKeys().some((key) => key.includes("cluster-a__conversation-1"))).toBe(true);

    // A fresh agent on the same storage, as after an application restart.
    const after = setup([textTurn("Done.")], backend);
    const chunks = await collect(after.service.run({ kind: "resume", answer: "yes" }));

    expect(after.executed).toEqual(["pod-a"]);
    expect(textOf(chunks)).toBe("Done.");
    expect(after.agent.messages[0].role).toBe("user");
  });

  it("drops a pending approval when the user sends a new message instead", async () => {
    const { service, executed, agent } = setup([
      toolUseTurn("deleteThing", "tool-1", { name: "pod-a" }),
      textTurn("Sure, something else."),
    ]);

    await collect(service.run({ kind: "message", text: "delete pod-a" }));
    const chunks = await collect(service.run({ kind: "message", text: "never mind" }));

    expect(executed).toEqual([]);
    expect(textOf(chunks)).toBe("Sure, something else.");
    // No dangling tool use: the paused call was never committed to the history.
    const blockTypes = agent.messages.flatMap((message) => message.content.map((block) => block.type));
    expect(blockTypes).not.toContain("toolUseBlock");
  });

  it("ignores an answer when no approval is pending", async () => {
    const { service } = setup([]);
    expect(await collect(service.run({ kind: "resume", answer: "yes" }))).toEqual([]);
  });

  it("asks for approval before every MCP tool call", async () => {
    const { service, executed } = setup(
      [toolUseTurn("mcpEcho", "tool-1", {}), textTurn("Echoed.")],
      new MemoryBackend(),
      true,
    );

    const first = await collect(service.run({ kind: "message", text: "echo" }));
    const approvals = first.filter(isApprovalChunk);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].approval.requestString).toBe("The agent wants to use this tool: mcpEcho");
    expect(executed).toEqual([]);

    await collect(service.run({ kind: "resume", answer: "yes" }));
    expect(executed).toEqual(["mcpEcho"]);
  });

  it("forgets the conversation on reset", async () => {
    const backend = new MemoryBackend();
    const { service, agent } = setup([textTurn("Hello!")], backend);
    await collect(service.run({ kind: "message", text: "hi" }));
    expect(agent.messages.length).toBeGreaterThan(0);

    await resetConversation(agent);

    expect(agent.messages).toEqual([]);
    const restored = setup([], backend);
    await restored.agent.initialize();
    expect(restored.agent.messages).toEqual([]);
  });
});
