import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getClusterVersionTool } from "../../common/agent-tools";
import { AgentHost, type AgentHostOptions } from "./agent-host";

import type { AgentEnvelope, AgentSnapshot } from "../../common/agent-protocol";

type Faux = ReturnType<typeof fauxProvider>;

describe("AgentHost", () => {
  let dataDir: string;
  let modelRuntime: ModelRuntime;
  let faux: Faux;
  let envelopes: AgentEnvelope[];
  let host: AgentHost | undefined;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "agent-host-"));
    modelRuntime = await ModelRuntime.create({
      authPath: join(dataDir, "pi", "auth.json"),
      modelsPath: join(dataDir, "pi", "models.json"),
    });
    faux = fauxProvider({ tokensPerSecond: 100_000 });
    modelRuntime.registerNativeProvider(faux.provider);
    envelopes = [];
  });

  afterEach(() => {
    host?.dispose();
    host = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const createHost = (overrides: Partial<AgentHostOptions> = {}) => {
    const model = faux.getModel();
    host = new AgentHost({
      dataDir,
      modelRuntime,
      broadcast: (envelope) => envelopes.push(envelope),
      tools: [getClusterVersionTool],
      getModelRef: () => ({ provider: model.provider, id: model.id }),
      retry: false,
      ...overrides,
    });
    return host;
  };

  const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  const eventTypes = () => envelopes.filter((e) => e.kind === "event").map((e) => e.payload.type);
  const settled = () => eventTypes().includes("agent_settled");

  it("streams a prompt's answer as event envelopes with increasing seq", async () => {
    faux.setResponses([fauxAssistantMessage([fauxText("Hello from the cluster assistant.")])]);
    const host = createHost();

    const response = await host.handleCommand("c1", { type: "prompt", message: "hi" });
    expect(response).toMatchObject({ type: "response", command: "prompt", success: true });

    await waitFor(settled);
    expect(envelopes.every((e) => e.clusterId === "c1" && e.kind === "event")).toBe(true);
    expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, index) => index + 1));
    expect(new Set(envelopes.map((e) => e.sessionId)).size).toBe(1);

    const text = envelopes
      .flatMap((e) => (e.kind === "event" && e.payload.type === "message_update" ? [e.payload] : []))
      .map((p) => (p.assistantMessageEvent.type === "text_delta" ? p.assistantMessageEvent.delta : ""))
      .join("");
    expect(text).toBe("Hello from the cluster assistant.");
  });

  it("strips partial messages from deltas and does not forward entry_appended", async () => {
    faux.setResponses([fauxAssistantMessage([fauxText("Some text")])]);
    const host = createHost();

    await host.handleCommand("c1", { type: "prompt", message: "hi" });
    await waitFor(settled);

    expect(eventTypes()).not.toContain("entry_appended");
    const updates = envelopes.flatMap((e) =>
      e.kind === "event" && e.payload.type === "message_update" ? [e.payload] : [],
    );
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update.assistantMessageEvent).not.toHaveProperty("partial");
      expect(update).not.toHaveProperty("message");
    }
  });

  it("sends a tool call to the frame as a tool_request and resolves it from tool_result", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("getClusterVersion", {})], { stopReason: "toolUse" }),
      (context) => {
        const last = context.messages[context.messages.length - 1];
        const result = last?.role === "toolResult" ? last.content.map((c) => (c.type === "text" ? c.text : "")) : [];
        return fauxAssistantMessage([fauxText(`The cluster runs ${result.join("")}.`)]);
      },
    ]);
    const host = createHost();

    await host.handleCommand("c1", { type: "prompt", message: "which version?" });
    await waitFor(() => envelopes.some((e) => e.kind === "tool_request"));

    const request = envelopes.find((e) => e.kind === "tool_request");
    expect(request).toMatchObject({
      clusterId: "c1",
      kind: "tool_request",
      payload: { toolName: "getClusterVersion" },
    });
    if (request?.kind !== "tool_request") throw new Error("no tool request");

    const toolResponse = await host.handleCommand("c1", {
      type: "tool_result",
      requestId: request.payload.requestId,
      text: "v1.31.2",
    });
    expect(toolResponse).toMatchObject({ success: true });

    await waitFor(settled);
    const finalText = envelopes
      .flatMap((e) => (e.kind === "event" && e.payload.type === "message_update" ? [e.payload] : []))
      .map((p) => (p.assistantMessageEvent.type === "text_delta" ? p.assistantMessageEvent.delta : ""))
      .join("");
    expect(finalText).toBe("The cluster runs v1.31.2.");
  });

  it("turns a tool request that the frame never answers into an error result", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("getClusterVersion", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    const host = createHost({ toolTimeoutMs: 20 });

    await host.handleCommand("c1", { type: "prompt", message: "which version?" });
    await waitFor(settled);

    const toolEnd = envelopes.find((e) => e.kind === "event" && e.payload.type === "tool_execution_end");
    expect(toolEnd).toMatchObject({ payload: { isError: true } });
  });

  it("rejects a tool_result for an unknown request", async () => {
    const host = createHost();
    const response = await host.handleCommand("c1", { type: "tool_result", requestId: "nope", text: "x" });
    expect(response).toMatchObject({ success: false });
  });

  it("refuses a prompt when no model is selected", async () => {
    const host = createHost({ getModelRef: () => undefined });
    const response = await host.handleCommand("c1", { type: "prompt", message: "hi" });
    expect(response).toMatchObject({ success: false });
    expect(envelopes).toEqual([]);
  });

  it("refuses a prompt when the model's provider has no credentials", async () => {
    const host = createHost({ getModelRef: () => ({ provider: "openai", id: "gpt-5.5" }) });
    const response = await host.handleCommand("c1", { type: "prompt", message: "hi" });
    expect(response).toMatchObject({ success: false });
    if (response.success) throw new Error("expected failure");
    expect(response.error).toMatch(/no credentials for openai/i);
  });

  it("writes the chat to a JSONL file in the cluster's session folder", async () => {
    faux.setResponses([fauxAssistantMessage([fauxText("Saved")])]);
    const host = createHost();

    await host.handleCommand("c1", { type: "prompt", message: "hi" });
    await waitFor(settled);

    const files = readdirSync(join(dataDir, "sessions", "c1"));
    expect(files.some((file) => file.endsWith(".jsonl"))).toBe(true);
  });

  it("keeps clusters apart: each has its own session and seq", async () => {
    faux.setResponses([fauxAssistantMessage([fauxText("one")]), fauxAssistantMessage([fauxText("two")])]);
    const host = createHost();

    await host.handleCommand("c1", { type: "prompt", message: "hi" });
    await waitFor(settled);
    const firstCount = envelopes.length;
    await host.handleCommand("c2", { type: "prompt", message: "hi" });
    await waitFor(
      () =>
        envelopes.filter((e) => e.clusterId === "c2" && e.kind === "event" && e.payload.type === "agent_settled")
          .length > 0,
    );

    const c2 = envelopes.slice(firstCount);
    expect(c2.every((e) => e.clusterId === "c2")).toBe(true);
    expect(c2[0]?.seq).toBe(1);
    expect(c2[0]?.sessionId).not.toBe(envelopes[0]?.sessionId);
  });

  const toolCallThenText = () => [
    fauxAssistantMessage([fauxToolCall("getClusterVersion", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ];
  const snapshotOf = async (host: AgentHost, clusterId = "c1") => {
    const response = await host.handleCommand(clusterId, { type: "get_snapshot" });
    if (!response.success) throw new Error(response.error);
    return response.data as AgentSnapshot;
  };

  it("stops a run on abort, failing the tool call the frame has not answered", async () => {
    faux.setResponses(toolCallThenText());
    const host = createHost({ toolTimeoutMs: 60_000 });

    await host.handleCommand("c1", { type: "prompt", message: "which version?" });
    await waitFor(() => envelopes.some((e) => e.kind === "tool_request"));

    const response = await host.handleCommand("c1", { type: "abort" });
    expect(response).toMatchObject({ command: "abort", success: true });

    await waitFor(settled);
    expect(eventTypes()).toContain("tool_execution_end");
    expect((await snapshotOf(host)).isStreaming).toBe(false);
  });

  it("answers abort when nothing is running", async () => {
    const host = createHost();
    expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });
  });

  it("snapshots a run in progress with its pending tool request and current seq", async () => {
    faux.setResponses(toolCallThenText());
    const host = createHost({ toolTimeoutMs: 60_000 });

    await host.handleCommand("c1", { type: "prompt", message: "which version?" });
    await waitFor(() => envelopes.some((e) => e.kind === "tool_request"));

    const snapshot = await snapshotOf(host);
    const request = envelopes.find((e) => e.kind === "tool_request");
    expect(snapshot.isStreaming).toBe(true);
    expect(snapshot.seq).toBe(envelopes[envelopes.length - 1]?.seq);
    expect(snapshot.sessionId).toBe(envelopes[0]?.sessionId);
    expect(snapshot.pendingToolRequests).toEqual([request?.payload]);
    expect(snapshot.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(snapshot.autoApprove).toBe(false);
  });

  it("snapshots an empty chat for a cluster that never ran", async () => {
    const host = createHost();
    const snapshot = await snapshotOf(host, "fresh");

    expect(snapshot).toMatchObject({ messages: [], isStreaming: false, pendingToolRequests: [], seq: 0 });
  });

  it("rebuilds the chat from the session file after a restart", async () => {
    faux.setResponses([fauxAssistantMessage([fauxText("Saved answer")])]);
    const first = createHost();
    await first.handleCommand("c1", { type: "prompt", message: "hi" });
    await waitFor(settled);
    first.dispose();

    const restarted = createHost();
    const snapshot = await snapshotOf(restarted);

    expect(snapshot.isStreaming).toBe(false);
    expect(snapshot.seq).toBe(0);
    expect(snapshot.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const answer = snapshot.messages[1];
    expect(answer?.role === "assistant" && answer.content).toEqual([{ type: "text", text: "Saved answer" }]);
  });

  it("does not wait for the frames: a broadcast that never completes does not stall the run", async () => {
    faux.setResponses([fauxAssistantMessage([fauxText("Not blocked")])]);
    const host = createHost({
      broadcast: (envelope) => {
        envelopes.push(envelope);
        return new Promise<void>(() => undefined) as unknown as void;
      },
    });

    await host.handleCommand("c1", { type: "prompt", message: "hi" });
    await waitFor(settled);
  });

  it("keeps the run going when a broadcast throws", async () => {
    faux.setResponses([fauxAssistantMessage([fauxText("Still running")])]);
    let calls = 0;
    const host = createHost({
      broadcast: () => {
        calls += 1;
        throw new Error("frame gone");
      },
    });

    await host.handleCommand("c1", { type: "prompt", message: "hi" });
    await waitFor(() => calls > 0);
    const deadline = Date.now() + 5000;
    while ((await snapshotOf(host)).isStreaming && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const snapshot = await snapshotOf(host);
    expect(snapshot.isStreaming).toBe(false);
    expect(snapshot.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("gives the agent only our tools and our system prompt", async () => {
    let seenTools: string[] = [];
    let seenPrompt = "";
    faux.setResponses([
      (context) => {
        // pi carries the prompt and the tool declarations in system messages.
        for (const message of context.messages) {
          if (message.role !== "system") continue;
          const content =
            typeof message.content === "string" ? message.content : message.content.map((c) => c.text).join("");
          seenPrompt += content + Object.values(message.sections ?? {}).join("");
          seenTools.push(...(message.toolsAdded ?? []).map((tool) => tool.name));
        }
        return fauxAssistantMessage([fauxText("ok")]);
      },
    ]);
    const host = createHost({ systemPrompt: "You are the Freelens AI test assistant." });

    await host.handleCommand("c1", { type: "prompt", message: "hi" });
    await waitFor(settled);

    expect(seenTools).toEqual(["getClusterVersion"]);
    expect(seenPrompt).toContain("You are the Freelens AI test assistant.");
    expect(seenPrompt).not.toMatch(/\bbash\b/i);
  });
});
