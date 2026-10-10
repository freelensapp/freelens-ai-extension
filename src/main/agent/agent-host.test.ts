import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createKubernetesResourceTool,
  getClusterVersionTool,
  getPodLogsTool,
  patchKubernetesResourceTool,
} from "../../common/agent-tools";
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

  describe("chats and retention", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const sessionFiles = (clusterId: string) => {
      try {
        return readdirSync(join(dataDir, "sessions", clusterId))
          .filter((file) => file.endsWith(".jsonl"))
          .sort();
      } catch {
        return [];
      }
    };
    const chat = async (host: AgentHost, clusterId: string, text: string) => {
      const before = envelopes.length;
      faux.setResponses([fauxAssistantMessage([fauxText(text)])]);
      const response = await host.handleCommand(clusterId, { type: "prompt", message: text });
      if (!response.success) throw new Error(response.error);
      await waitFor(() =>
        envelopes
          .slice(before)
          .some((e) => e.clusterId === clusterId && e.kind === "event" && e.payload.type === "agent_settled"),
      );
    };
    const answers = (snapshot: AgentSnapshot) =>
      snapshot.messages
        .flatMap((m) => (m.role === "assistant" ? m.content : []))
        .map((c) => (c as { text?: string }).text);

    it("starts a new chat in a new session file and keeps the old file", async () => {
      const host = createHost();
      await chat(host, "c1", "first chat");
      const [firstFile] = sessionFiles("c1");
      const firstSession = (await snapshotOf(host)).sessionId;

      const response = await host.handleCommand("c1", { type: "new_session" });
      expect(response).toMatchObject({ command: "new_session", success: true });
      const fresh = response.success ? (response.data as AgentSnapshot) : undefined;
      expect(fresh).toMatchObject({ messages: [], isStreaming: false });
      expect(fresh?.sessionId).not.toBe(firstSession);
      expect(sessionFiles("c1")).toEqual([firstFile]);

      await chat(host, "c1", "second chat");
      expect(sessionFiles("c1")).toHaveLength(2);
      expect(answers(await snapshotOf(host))).toEqual(["second chat"]);
    });

    it("stops a running run before starting the new chat", async () => {
      faux.setResponses(toolCallThenText());
      const host = createHost({ toolTimeoutMs: 60_000 });
      await host.handleCommand("c1", { type: "prompt", message: "which version?" });
      await waitFor(() => envelopes.some((e) => e.kind === "tool_request"));

      const response = await host.handleCommand("c1", { type: "new_session" });

      expect(response).toMatchObject({ success: true });
      expect(eventTypes()).toContain("agent_settled");
      const snapshot = await snapshotOf(host);
      expect(snapshot).toMatchObject({ messages: [], isStreaming: false, pendingToolRequests: [] });
      expect(response.success && (response.data as AgentSnapshot).seq).toBe(snapshot.seq);
    });

    it("keeps the new chat after a restart instead of reopening the old one", async () => {
      const first = createHost();
      await chat(first, "c1", "old chat");
      await first.handleCommand("c1", { type: "new_session" });
      first.dispose();

      const restarted = createHost();
      expect((await snapshotOf(restarted)).messages).toEqual([]);
      await chat(restarted, "c1", "new chat");
      restarted.dispose();

      const again = createHost();
      expect(answers(await snapshotOf(again))).toEqual(["new chat"]);
    });

    it("drops the New chat marker as soon as the first prompt is saved, so a restart reopens that chat", async () => {
      const first = createHost();
      await chat(first, "c1", "old chat");
      await first.handleCommand("c1", { type: "new_session" });
      let markerWhenAnswering: boolean | undefined;
      faux.setResponses([
        () => {
          markerWhenAnswering = existsSync(join(dataDir, "sessions", "c1", ".new-chat"));
          return fauxAssistantMessage([fauxText("new answer")]);
        },
      ]);
      await first.handleCommand("c1", { type: "prompt", message: "new question" });
      await waitFor(() => markerWhenAnswering !== undefined);

      expect(markerWhenAnswering).toBe(false);
    });

    it("deletes every session file of the cluster and starts an empty chat", async () => {
      const host = createHost();
      await chat(host, "c1", "one");
      await host.handleCommand("c1", { type: "new_session" });
      await chat(host, "c1", "two");
      await chat(host, "c2", "other cluster");

      const response = await host.handleCommand("c1", { type: "delete_sessions" });

      expect(response).toMatchObject({ command: "delete_sessions", success: true });
      expect(sessionFiles("c1")).toEqual([]);
      expect(sessionFiles("c2")).toHaveLength(1);
      expect((await snapshotOf(host)).messages).toEqual([]);
      await chat(host, "c1", "after delete");
      expect(answers(await snapshotOf(host))).toEqual(["after delete"]);
    });

    it("prunes chats older than the retention period but keeps each cluster's active chat", async () => {
      let now = Date.now();
      const host = createHost({ now: () => now, getRetentionDays: () => 30 });
      await chat(host, "c1", "old");
      await host.handleCommand("c1", { type: "new_session" });
      await chat(host, "c1", "active");
      // File names start with their creation time, so the new chat sorts last.
      const [, activeFile] = sessionFiles("c1");
      expect(sessionFiles("c1")).toHaveLength(2);

      expect(await host.pruneSessions()).toBe(0);
      expect(sessionFiles("c1")).toHaveLength(2);

      now += 31 * DAY_MS;
      expect(await host.pruneSessions()).toBe(1);
      expect(sessionFiles("c1")).toEqual([activeFile]);
      expect(answers(await snapshotOf(host))).toEqual(["active"]);
    });

    it("keeps chats newer than the retention period", async () => {
      const now = Date.now() + 31 * DAY_MS;
      const host = createHost({ now: () => now, getRetentionDays: () => 60 });
      await chat(host, "c1", "old");
      await host.handleCommand("c1", { type: "new_session" });
      await chat(host, "c1", "active");

      expect(await host.pruneSessions()).toBe(0);
      expect(sessionFiles("c1")).toHaveLength(2);
    });

    it("never prunes when the retention is 0 days", async () => {
      const now = Date.now() + 365 * DAY_MS;
      const host = createHost({ now: () => now, getRetentionDays: () => 0 });
      await chat(host, "c1", "old");
      await host.handleCommand("c1", { type: "new_session" });

      expect(await host.pruneSessions()).toBe(0);
      expect(sessionFiles("c1")).toHaveLength(1);
    });

    it("prunes the folders of clusters that are not loaded, keeping their latest chat unless the cluster is gone", async () => {
      const first = createHost();
      await chat(first, "c1", "c1 old");
      await first.handleCommand("c1", { type: "new_session" });
      await chat(first, "c1", "c1 latest");
      await chat(first, "removed", "removed cluster");
      first.dispose();

      const now = Date.now() + 31 * DAY_MS;
      const restarted = createHost({ now: () => now, knownClusterIds: () => ["c1"] });
      expect(await restarted.pruneSessions()).toBe(2);
      expect(sessionFiles("c1")).toHaveLength(1);
      expect(sessionFiles("removed")).toEqual([]);
      expect(answers(await snapshotOf(restarted))).toEqual(["c1 latest"]);
    });

    it("keeps the latest chat of every folder when told not to trust the cluster list", async () => {
      const first = createHost();
      await chat(first, "c1", "c1 latest");
      await chat(first, "not-listed-yet", "latest of a cluster the catalog has not loaded");
      first.dispose();

      const now = Date.now() + 31 * DAY_MS;
      const restarted = createHost({ now: () => now, knownClusterIds: () => ["c1"] });
      expect(await restarted.pruneSessions({ dropRemovedClusters: false })).toBe(0);
      expect(sessionFiles("not-listed-yet")).toHaveLength(1);
    });

    // The prompt is either stopped by New chat or runs in the new chat; a run
    // in the closed session would send tool calls no snapshot knows about.
    it.each([
      0, 1, 2, 4, 8,
    ])("never leaves a prompt sent just before New chat running unseen (%i ticks apart)", async (ticks) => {
      const host = createHost({ toolTimeoutMs: 60_000 });
      await chat(host, "c1", "warm up");
      let resetDone = false;
      let hiddenCalls = 0;
      faux.setResponses([
        (context) => {
          const text = JSON.stringify(context.messages);
          if (resetDone && text.includes("warm up")) hiddenCalls += 1;
          return fauxAssistantMessage([fauxToolCall("getClusterVersion", {})], { stopReason: "toolUse" });
        },
        fauxAssistantMessage([fauxText("done")]),
      ]);

      const prompting = host.handleCommand("c1", { type: "prompt", message: "which version?" });
      for (let tick = 0; tick < ticks; tick++) await new Promise((resolve) => setImmediate(resolve));
      const reset = await host.handleCommand("c1", { type: "new_session" });
      resetDone = true;
      expect(reset).toMatchObject({ success: true });
      await prompting;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(hiddenCalls).toBe(0);

      const snapshot = await snapshotOf(host);
      expect(answers(snapshot)).not.toContain("warm up");
      if (snapshot.pendingToolRequests.length > 0) {
        expect(snapshot.isStreaming).toBe(true);
        expect(snapshot.messages[0]).toMatchObject({ role: "user" });
      }
    });

    it("prunes on New chat, so the chat it leaves behind can go too", async () => {
      const now = Date.now() + 31 * DAY_MS;
      const host = createHost({ now: () => now });
      await chat(host, "c1", "stale");
      expect(sessionFiles("c1")).toHaveLength(1);

      await host.handleCommand("c1", { type: "new_session" });

      await waitFor(() => sessionFiles("c1").length === 0);
    });
  });

  describe("approval gate", () => {
    const gatedTools = [
      getClusterVersionTool,
      getPodLogsTool,
      createKubernetesResourceTool,
      patchKubernetesResourceTool,
    ];

    // The model calls `toolName` once, then answers with the text of the tool result it got.
    const callThenEcho = (toolName: string, args: Parameters<typeof fauxToolCall>[1]) => [
      fauxAssistantMessage([fauxToolCall(toolName, args)], { stopReason: "toolUse" }),
      (context: { messages: Array<{ role: string; content?: unknown }> }) => {
        const last = context.messages[context.messages.length - 1];
        const parts = last?.role === "toolResult" ? (last.content as Array<{ type: string; text?: string }>) : [];
        return fauxAssistantMessage([fauxText(`Result: ${parts.map((part) => part.text ?? "").join("")}`)]);
      },
    ];
    const scaleWeb = { kind: "Deployment", name: "web", namespace: "default", data: { spec: { replicas: 3 } } };

    const uiRequests = () => envelopes.flatMap((e) => (e.kind === "ui_request" ? [e.payload] : []));
    const uiResolved = () => envelopes.flatMap((e) => (e.kind === "ui_resolved" ? [e.payload] : []));
    const toolRequests = () => envelopes.flatMap((e) => (e.kind === "tool_request" ? [e.payload] : []));
    const answerText = () =>
      envelopes
        .flatMap((e) => (e.kind === "event" && e.payload.type === "message_update" ? [e.payload] : []))
        .map((p) => (p.assistantMessageEvent.type === "text_delta" ? p.assistantMessageEvent.delta : ""))
        .join("");

    it("asks before a mutating call and runs it in the frame once approved", async () => {
      faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
      const host = createHost({ tools: gatedTools, toolTimeoutMs: 60_000 });

      await host.handleCommand("c1", { type: "prompt", message: "scale web to 3" });
      await waitFor(() => uiRequests().length > 0);

      const request = uiRequests()[0]!;
      expect(request).toMatchObject({
        method: "confirm",
        title: "PATCH DEPLOYMENT",
        approval: {
          tool: "patchKubernetesResource",
          kind: "Deployment",
          apiVersion: "apps/v1",
          name: "web",
          namespace: "default",
        },
      });
      expect(request.message).toContain("replicas: 3");
      expect(toolRequests()).toEqual([]);
      expect((await snapshotOf(host)).pendingUiRequest).toEqual(request);

      const response = await host.handleCommand("c1", { type: "ui_response", id: request.id, confirmed: true });
      expect(response).toMatchObject({ success: true });
      await waitFor(() => toolRequests().length > 0);
      expect(uiResolved()).toEqual([{ id: request.id, confirmed: true }]);
      expect(toolRequests()[0]).toMatchObject({ toolName: "patchKubernetesResource", args: scaleWeb });
      expect((await snapshotOf(host)).pendingUiRequest).toBeUndefined();

      await host.handleCommand("c1", { type: "tool_result", requestId: toolRequests()[0]!.requestId, text: "patched" });
      await waitFor(settled);
      expect(answerText()).toBe("Result: patched");
    });

    it("blocks a denied call without sending it to the frame", async () => {
      faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
      const host = createHost({ tools: gatedTools });

      await host.handleCommand("c1", { type: "prompt", message: "scale web to 3" });
      await waitFor(() => uiRequests().length > 0);
      await host.handleCommand("c1", { type: "ui_response", id: uiRequests()[0]!.id, confirmed: false });
      await waitFor(settled);

      expect(toolRequests()).toEqual([]);
      expect(uiResolved()).toEqual([{ id: uiRequests()[0]!.id, confirmed: false }]);
      expect(answerText()).toBe("Result: The user denied the action");
    });

    it("rejects an invalid manifest with its validation error and never asks", async () => {
      faux.setResponses(callThenEcho("createKubernetesResource", { kind: "Pod", data: { metadata: { name: "p" } } }));
      const host = createHost({ tools: gatedTools });

      await host.handleCommand("c1", { type: "prompt", message: "create a pod" });
      await waitFor(settled);

      expect(uiRequests()).toEqual([]);
      expect(toolRequests()).toEqual([]);
      expect(answerText()).toMatch(/^Result: The Pod manifest is invalid: /);
    });

    it("sends the prepared manifest the user approved to the frame", async () => {
      const service = {
        kind: "Service",
        data: {
          apiVersion: "v9",
          kind: "Wrong",
          metadata: { name: "svc", namespace: "shop" },
          spec: { ports: [{ port: 80, targetPort: 8080 }] },
        },
      };
      faux.setResponses(callThenEcho("createKubernetesResource", service));
      const host = createHost({ tools: gatedTools, toolTimeoutMs: 60_000 });

      await host.handleCommand("c1", { type: "prompt", message: "create a service" });
      await waitFor(() => uiRequests().length > 0);
      const request = uiRequests()[0]!;
      expect(request).toMatchObject({
        title: "CREATE SERVICE",
        approval: { kind: "Service", apiVersion: "v1", name: "svc", namespace: "shop" },
      });
      await host.handleCommand("c1", { type: "ui_response", id: request.id, confirmed: true });
      await waitFor(() => toolRequests().length > 0);

      expect(toolRequests()[0]!.args).toEqual({
        kind: "Service",
        name: "svc",
        namespace: "shop",
        data: {
          apiVersion: "v1",
          kind: "Service",
          metadata: { name: "svc", namespace: "shop" },
          spec: { ports: [{ port: 80, targetPort: 8080 }] },
        },
      });
      expect(request.message).toContain("apiVersion: v1");
      expect(request.message).not.toContain("v9");
    });

    it("denies a pending approval on Stop and ends the run", async () => {
      faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
      const host = createHost({ tools: gatedTools });

      await host.handleCommand("c1", { type: "prompt", message: "scale web to 3" });
      await waitFor(() => uiRequests().length > 0);

      expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });
      await waitFor(settled);

      expect(uiResolved()).toEqual([{ id: uiRequests()[0]!.id, confirmed: false }]);
      expect(toolRequests()).toEqual([]);
      const snapshot = await snapshotOf(host);
      expect(snapshot.isStreaming).toBe(false);
      expect(snapshot.pendingUiRequest).toBeUndefined();
    });

    it("asks for pod logs only while the approval setting says so", async () => {
      faux.setResponses(callThenEcho("getPodLogs", { name: "web-1", namespace: "default" }));
      const host = createHost({
        tools: gatedTools,
        toolTimeoutMs: 60_000,
        requiresApproval: (tool) => tool.name !== "getPodLogs" && tool.requiresApprovalByDefault,
      });

      await host.handleCommand("c1", { type: "prompt", message: "show the logs" });
      await waitFor(() => toolRequests().length > 0);

      expect(uiRequests()).toEqual([]);
      expect(toolRequests()[0]).toMatchObject({ toolName: "getPodLogs" });
    });

    it("rejects a ui_response for an unknown request", async () => {
      const host = createHost();
      const response = await host.handleCommand("c1", { type: "ui_response", id: "nope", confirmed: true });
      expect(response).toMatchObject({ success: false });
    });

    describe("approve all in this chat", () => {
      const autoApproveChanges = () => envelopes.flatMap((e) => (e.kind === "auto_approve" ? [e.payload] : []));
      const scaleApi = { ...scaleWeb, name: "api" };
      // Two changes in one run, the second after the first one's result.
      const twoPatches = () => [
        fauxAssistantMessage([fauxToolCall("patchKubernetesResource", scaleWeb)], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("patchKubernetesResource", scaleApi)], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("both scaled")]),
      ];
      const answerToolRequests = async (host: AgentHost, count: number) => {
        for (let index = 0; index < count; index++) {
          await waitFor(() => toolRequests().length > index);
          await host.handleCommand("c1", {
            type: "tool_result",
            requestId: toolRequests()[index]!.requestId,
            text: "patched",
          });
        }
      };

      it("approves the pending call and runs the next gated call without asking", async () => {
        faux.setResponses(twoPatches());
        const host = createHost({ tools: gatedTools, toolTimeoutMs: 60_000 });

        await host.handleCommand("c1", { type: "prompt", message: "scale web and api" });
        await waitFor(() => uiRequests().length > 0);
        const request = uiRequests()[0]!;
        const response = await host.handleCommand("c1", {
          type: "ui_response",
          id: request.id,
          confirmed: true,
          approveAll: true,
        });
        expect(response).toMatchObject({ success: true });
        expect(autoApproveChanges()).toEqual([{ enabled: true }]);
        expect((await snapshotOf(host)).autoApprove).toBe(true);

        await answerToolRequests(host, 2);
        await waitFor(settled);

        expect(uiRequests()).toEqual([request]);
        expect(uiResolved()).toEqual([{ id: request.id, confirmed: true }]);
        expect(toolRequests().map((r) => r.args.name)).toEqual(["web", "api"]);
        const executed = envelopes.flatMap((e) =>
          e.kind === "event" && e.payload.type === "tool_execution_end" ? [e.payload.toolName] : [],
        );
        expect(executed).toEqual(["patchKubernetesResource", "patchKubernetesResource"]);
      });

      it("ignores approveAll on a denial", async () => {
        faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
        const host = createHost({ tools: gatedTools });

        await host.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(() => uiRequests().length > 0);
        await host.handleCommand("c1", {
          type: "ui_response",
          id: uiRequests()[0]!.id,
          confirmed: false,
          approveAll: true,
        });
        await waitFor(settled);

        expect(autoApproveChanges()).toEqual([]);
        expect((await snapshotOf(host)).autoApprove).toBe(false);
      });

      it("still blocks an invalid manifest while approving all", async () => {
        faux.setResponses([
          ...twoPatches().slice(0, 1),
          fauxAssistantMessage(
            [fauxToolCall("createKubernetesResource", { kind: "Pod", data: { metadata: { name: "p" } } })],
            {
              stopReason: "toolUse",
            },
          ),
          (context) => {
            const last = context.messages[context.messages.length - 1];
            const parts = last?.role === "toolResult" ? last.content : [];
            return fauxAssistantMessage([
              fauxText(`Result: ${parts.map((part) => (part.type === "text" ? part.text : "")).join("")}`),
            ]);
          },
        ]);
        const host = createHost({ tools: gatedTools, toolTimeoutMs: 60_000 });

        await host.handleCommand("c1", { type: "prompt", message: "scale web, then create a pod" });
        await waitFor(() => uiRequests().length > 0);
        await host.handleCommand("c1", {
          type: "ui_response",
          id: uiRequests()[0]!.id,
          confirmed: true,
          approveAll: true,
        });
        await answerToolRequests(host, 1);
        await waitFor(settled);

        expect(uiRequests()).toHaveLength(1);
        expect(toolRequests()).toHaveLength(1);
        expect(answerText()).toMatch(/Result: The Pod manifest is invalid: /);
      });

      it("asks again once it is turned off", async () => {
        faux.setResponses(twoPatches());
        const host = createHost({ tools: gatedTools, toolTimeoutMs: 60_000 });

        await host.handleCommand("c1", { type: "prompt", message: "scale web and api" });
        await waitFor(() => uiRequests().length > 0);
        await host.handleCommand("c1", {
          type: "ui_response",
          id: uiRequests()[0]!.id,
          confirmed: true,
          approveAll: true,
        });

        const response = await host.handleCommand("c1", { type: "set_auto_approve", enabled: false });
        expect(response).toMatchObject({ command: "set_auto_approve", success: true });
        expect(autoApproveChanges()).toEqual([{ enabled: true }, { enabled: false }]);
        expect((await snapshotOf(host)).autoApprove).toBe(false);

        await answerToolRequests(host, 1);
        await waitFor(() => uiRequests().length > 1);
        expect(uiRequests()[1]).toMatchObject({ approval: { name: "api" } });
        expect(toolRequests()).toHaveLength(1);
      });

      it("answers turning it off when it is not on", async () => {
        const host = createHost();
        expect(await host.handleCommand("c1", { type: "set_auto_approve", enabled: false })).toMatchObject({
          success: true,
        });
        expect(autoApproveChanges()).toEqual([]);
      });

      it.each(["new_session", "delete_sessions"] as const)("is cleared by %s", async (type) => {
        faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
        const host = createHost({ tools: gatedTools, toolTimeoutMs: 60_000 });
        await host.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(() => uiRequests().length > 0);
        await host.handleCommand("c1", {
          type: "ui_response",
          id: uiRequests()[0]!.id,
          confirmed: true,
          approveAll: true,
        });
        await answerToolRequests(host, 1);
        await waitFor(settled);

        const response = await host.handleCommand("c1", { type });
        expect(response.success && (response.data as AgentSnapshot).autoApprove).toBe(false);

        faux.setResponses(callThenEcho("patchKubernetesResource", scaleApi));
        await host.handleCommand("c1", { type: "prompt", message: "scale api" });
        await waitFor(() => uiRequests().length > 1);
        expect(toolRequests()).toHaveLength(1);
      });

      it("is cleared by a restart", async () => {
        faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
        const first = createHost({ tools: gatedTools, toolTimeoutMs: 60_000 });
        await first.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(() => uiRequests().length > 0);
        await first.handleCommand("c1", {
          type: "ui_response",
          id: uiRequests()[0]!.id,
          confirmed: true,
          approveAll: true,
        });
        await answerToolRequests(first, 1);
        await waitFor(settled);
        first.dispose();

        const restarted = createHost({ tools: gatedTools });
        expect((await snapshotOf(restarted)).autoApprove).toBe(false);
      });
    });
  });
});
