import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolCallEvent,
  type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_CHAT_RETENTION_DAYS } from "../../common/agent-protocol";
import { prepareApproval } from "../../common/agent-tools/approval";
import { toJsonEvent } from "./json-event";
import { SYSTEM_PROMPT } from "./system-prompt";

import type { Model } from "@earendil-works/pi-ai";

import type {
  AgentCommand,
  AgentEnvelope,
  AgentResponse,
  AgentSnapshot,
  ApprovalRequest,
  ChatMessage,
  ToolRequest,
} from "../../common/agent-protocol";
import type { AgentToolDefinition } from "../../common/agent-tools";

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const DENIED_REASON = "The user denied the action";
const DAY_MS = 24 * 60 * 60 * 1000;
// Left in a cluster's session folder by New chat until the new chat has a
// file, so a restart in between does not reopen the chat the user left.
const NEW_CHAT_MARKER = ".new-chat";

export interface ModelRef {
  provider: string;
  id: string;
}

export interface AgentHostOptions {
  /** The extension's own folder: sessions go under `sessions/`, pi's files under `pi/`. */
  dataDir: string;
  modelRuntime: ModelRuntime;
  broadcast: (envelope: AgentEnvelope) => void;
  tools: readonly AgentToolDefinition[];
  /** The model the next prompt runs on, or undefined when none is selected. */
  getModelRef: () => ModelRef | undefined;
  /** Whether a call of `tool` waits for the user's approval; read before every call. */
  requiresApproval?: (tool: AgentToolDefinition) => boolean;
  systemPrompt?: string;
  toolTimeoutMs?: number;
  /** pi retries temporary provider errors; tests turn that off. */
  retry?: boolean;
  /** Chats not changed for longer than this are deleted; 0 keeps them forever. Read before every prune. */
  getRetentionDays?: () => number;
  /**
   * The ids of the clusters Freelens knows. The folder of any other cluster
   * loses its latest chat to retention too. Undefined or empty: every folder
   * counts as a known cluster.
   */
  knownClusterIds?: () => readonly string[] | undefined;
  now?: () => number;
}

interface ClusterAgent {
  session: AgentSession;
}

interface PendingToolRequest {
  clusterId: string;
  request: ToolRequest;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

interface PendingApproval {
  clusterId: string;
  request: ApprovalRequest;
  settle: (confirmed: boolean) => void;
}

const ok = (command: string, data?: unknown): AgentResponse => ({ type: "response", command, success: true, data });
const fail = (command: string, error: string): AgentResponse => ({ type: "response", command, success: false, error });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The chat shows only these; pi's system prompt, tool results and custom
// entries stay in main.
const isChatMessage = (message: { role: string }): message is ChatMessage =>
  message.role === "user" || message.role === "assistant";

// Cluster ids name a folder on disk, so keep them to safe characters.
const safeFolderName = (clusterId: string) => clusterId.replace(/[^A-Za-z0-9._-]/g, "_");

/**
 * Owns one pi agent session per cluster in the main process. Frames talk to it
 * through `handleCommand`; everything it has to tell them goes out through the
 * injected `broadcast` as envelopes. It imports nothing from the Freelens host,
 * so it runs under vitest with pi's faux provider.
 */
export class AgentHost {
  private readonly clusters = new Map<string, Promise<ClusterAgent>>();
  private readonly pendingTools = new Map<string, PendingToolRequest>();
  // No timeout: an approval waits until the user answers or stops the run.
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  // Per cluster rather than per session, so a snapshot taken before the first
  // run reports 0.
  private readonly seqs = new Map<string, number>();
  // New chat or Delete all chats in progress, per cluster.
  private readonly resets = new Map<string, Promise<AgentResponse>>();
  // Prompts that pi has not started running yet, per cluster.
  private readonly preparing = new Map<string, Set<Promise<void>>>();

  constructor(private readonly options: AgentHostOptions) {}

  async handleCommand(clusterId: string, command: AgentCommand): Promise<AgentResponse> {
    switch (command.type) {
      case "prompt":
        return this.prompt(clusterId, command.message);
      case "abort":
        return this.abort(clusterId);
      case "get_snapshot":
        return this.snapshot(clusterId);
      case "new_session":
      case "delete_sessions":
        return this.resetChat(clusterId, command.type);
      case "tool_result":
        return this.toolResult(clusterId, command.requestId, command.text, command.isError ?? false);
      case "ui_response":
        return this.uiResponse(clusterId, command.id, command.confirmed);
      default:
        return fail((command as { type?: string }).type ?? "unknown", "Unknown command");
    }
  }

  dispose(): void {
    for (const pending of [...this.pendingApprovals.values()]) {
      pending.settle(false);
    }
    for (const [requestId, pending] of this.pendingTools) {
      pending.reject(new Error("The agent was stopped."));
      this.pendingTools.delete(requestId);
    }
    for (const cluster of this.clusters.values()) {
      cluster.then((agent) => agent.session.dispose()).catch(() => undefined);
    }
    this.clusters.clear();
  }

  private async prompt(clusterId: string, message: string): Promise<AgentResponse> {
    const ref = this.options.getModelRef();
    if (!ref) {
      return fail("prompt", "No model is selected. Choose a model for the chat first.");
    }
    const model = this.options.modelRuntime.getModel(ref.provider, ref.id);
    if (!model) {
      return fail("prompt", `The model ${ref.provider}/${ref.id} is not available.`);
    }
    if (!(await this.options.modelRuntime.checkAuth(model.provider))) {
      return fail(
        "prompt",
        `No credentials for ${model.provider}. Add an API key or sign in to ${model.provider} in the Freelens AI settings.`,
      );
    }

    // A prompt sent during New chat goes to the new chat.
    while (this.resets.has(clusterId)) {
      await this.resets.get(clusterId);
    }
    // Until pi starts the run, its abort does nothing, so New chat waits for
    // this prompt to get that far before it stops and closes the session.
    let prepared!: () => void;
    const preparation = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    const preparing = this.preparing.get(clusterId) ?? new Set();
    this.preparing.set(clusterId, preparing);
    preparing.add(preparation);
    void preparation.then(() => {
      preparing.delete(preparation);
      if (preparing.size === 0 && this.preparing.get(clusterId) === preparing) this.preparing.delete(clusterId);
    });

    let agent: ClusterAgent;
    try {
      agent = await this.getClusterAgent(clusterId, model);
      const current = agent.session.model;
      if (current?.provider !== model.provider || current?.id !== model.id) {
        await agent.session.setModel(model);
      }
    } catch (error) {
      prepared();
      return fail("prompt", errorText(error));
    }

    // Answer as soon as pi accepted the prompt; the run itself streams as
    // events, and a failure during the run arrives as an event too.
    return new Promise<AgentResponse>((resolve) => {
      let answered = false;
      const answer = (response: AgentResponse) => {
        prepared();
        if (!answered) {
          answered = true;
          resolve(response);
        }
      };
      agent.session
        .prompt(message, { preflightResult: (disposition) => answer(ok("prompt", { disposition })) })
        .then(() => answer(ok("prompt")))
        .catch((error) => {
          if (answered) {
            // Run errors normally arrive as events; this one escaped them.
            console.error(`[freelens-ai] The agent run for cluster ${clusterId} failed:`, error);
          }
          answer(fail("prompt", errorText(error)));
        });
    });
  }

  // Stop first denies a pending approval and fails the tool calls still waiting
  // on the frame: pi's abort waits for them, and they may never be answered.
  private async abort(clusterId: string): Promise<AgentResponse> {
    const agent = this.clusters.get(clusterId);
    if (!agent) return ok("abort");
    for (const pending of [...this.pendingApprovals.values()]) {
      if (pending.clusterId === clusterId) pending.settle(false);
    }
    for (const pending of [...this.pendingTools.values()]) {
      if (pending.clusterId === clusterId) pending.reject(new Error("The user stopped the run."));
    }
    try {
      await (await agent).session.abort();
      return ok("abort");
    } catch (error) {
      return fail("abort", errorText(error));
    }
  }

  /**
   * Deletes the session files not changed within the retention period, in
   * every cluster's folder, also of clusters that were since removed. The
   * active chat of each cluster is kept: the open session, or else the file
   * the next start would continue. Returns how many files were deleted.
   *
   * With `dropRemovedClusters: false` the cluster list is not used and every
   * folder keeps its latest chat: at startup the list may not be complete yet.
   */
  async pruneSessions({ dropRemovedClusters = true } = {}): Promise<number> {
    const days = this.options.getRetentionDays?.() ?? DEFAULT_CHAT_RETENTION_DAYS;
    const root = join(this.options.dataDir, "sessions");
    if (!(days > 0) || !existsSync(root)) return 0;
    const cutoff = (this.options.now ?? Date.now)() - days * DAY_MS;
    const known = dropRemovedClusters ? this.options.knownClusterIds?.() : undefined;
    const knownFolders = known?.length ? new Set(known.map(safeFolderName)) : undefined;

    let deleted = 0;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const sessions = await SessionManager.listAll(dir);
      const active = await this.activeSessionFile(entry.name, dir, knownFolders, sessions);
      let left = 0;
      for (const session of sessions) {
        if (session.path === active.file || session.modified.getTime() >= cutoff) {
          left += 1;
          continue;
        }
        try {
          unlinkSync(session.path);
          deleted += 1;
        } catch (error) {
          left += 1;
          console.error(`[freelens-ai] Deleting the old chat ${session.path} failed:`, error);
        }
      }
      // Tidy up the folder of a cluster with no chats left and no open session.
      if (left === 0 && !active.loaded) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    return deleted;
  }

  private async activeSessionFile(
    folder: string,
    dir: string,
    knownFolders: Set<string> | undefined,
    sessions: readonly { path: string }[],
  ): Promise<{ file?: string; loaded: boolean }> {
    for (const [clusterId, agent] of this.clusters) {
      if (safeFolderName(clusterId) !== folder) continue;
      const loaded = await agent.catch(() => undefined);
      if (loaded) return { file: loaded.session.sessionFile, loaded: true };
    }
    if ((knownFolders && !knownFolders.has(folder)) || existsSync(join(dir, NEW_CHAT_MARKER))) {
      return { loaded: false };
    }
    // The file SessionManager.continueRecent would open: the last one written.
    let latest: { path: string; mtime: number } | undefined;
    for (const { path } of sessions) {
      try {
        const mtime = statSync(path).mtimeMs;
        if (!latest || mtime > latest.mtime) latest = { path, mtime };
      } catch {
        // Deleted meanwhile.
      }
    }
    return { file: latest?.path, loaded: false };
  }

  // New chat and Delete all chats: stop the run and close the session; the
  // snapshot that answers opens a new one. New chat keeps the old files.
  // Resets of one cluster run one after the other, and prompts wait for them.
  private resetChat(clusterId: string, command: "new_session" | "delete_sessions"): Promise<AgentResponse> {
    const previous = this.resets.get(clusterId);
    const reset = (previous ?? Promise.resolve()).then(() => this.runReset(clusterId, command));
    this.resets.set(clusterId, reset);
    void reset.then(() => {
      if (this.resets.get(clusterId) === reset) this.resets.delete(clusterId);
    });
    return reset;
  }

  private async runReset(clusterId: string, command: "new_session" | "delete_sessions"): Promise<AgentResponse> {
    try {
      await this.closeClusterAgent(clusterId);
      const dir = this.sessionDir(clusterId);
      if (command === "delete_sessions") {
        rmSync(dir, { recursive: true, force: true });
      } else if (this.hasSessionFile(clusterId)) {
        writeFileSync(join(dir, NEW_CHAT_MARKER), "");
      }
    } catch (error) {
      return fail(command, errorText(error));
    }
    if (command === "new_session") {
      try {
        await this.pruneSessions();
      } catch (error) {
        console.error("[freelens-ai] Deleting old chats failed:", error);
      }
    }
    const snapshot = await this.snapshot(clusterId);
    return snapshot.success ? ok(command, snapshot.data) : fail(command, snapshot.error);
  }

  private async closeClusterAgent(clusterId: string): Promise<void> {
    await Promise.all(this.preparing.get(clusterId) ?? []);
    const agent = await this.clusters.get(clusterId)?.catch(() => undefined);
    if (!agent) return;
    const stopped = await this.abort(clusterId);
    if (!stopped.success) throw new Error(stopped.error);
    if ((await this.clusters.get(clusterId)?.catch(() => undefined)) === agent) {
      this.clusters.delete(clusterId);
    }
    agent.session.dispose();
  }

  private async snapshot(clusterId: string): Promise<AgentResponse> {
    const empty: AgentSnapshot = {
      messages: [],
      isStreaming: false,
      pendingToolRequests: [],
      autoApprove: false,
      seq: this.seqs.get(clusterId) ?? 0,
    };
    // Opening a session for a cluster that never chatted would create files.
    if (!this.clusters.has(clusterId) && !this.hasSessionFile(clusterId)) {
      return ok("get_snapshot", empty);
    }
    try {
      const { session } = await this.getClusterAgent(clusterId);
      // Read seq together with the state, after the await, so they match.
      const streaming = session.state.streamingMessage;
      const snapshot: AgentSnapshot = {
        ...empty,
        seq: this.seqs.get(clusterId) ?? 0,
        sessionId: session.sessionId,
        messages: session.messages.filter(isChatMessage),
        streamingMessage: streaming?.role === "assistant" ? streaming : undefined,
        isStreaming: session.isStreaming,
        pendingToolRequests: [...this.pendingTools.values()]
          .filter((pending) => pending.clusterId === clusterId)
          .map((pending) => pending.request),
        pendingUiRequest: [...this.pendingApprovals.values()].find((pending) => pending.clusterId === clusterId)
          ?.request,
      };
      return ok("get_snapshot", snapshot);
    } catch (error) {
      return fail("get_snapshot", errorText(error));
    }
  }

  private sessionDir(clusterId: string): string {
    return join(this.options.dataDir, "sessions", safeFolderName(clusterId));
  }

  private hasSessionFile(clusterId: string): boolean {
    const dir = this.sessionDir(clusterId);
    return existsSync(dir) && readdirSync(dir).some((file) => file.endsWith(".jsonl"));
  }

  private toolResult(clusterId: string, requestId: string, text: string, isError: boolean): AgentResponse {
    const pending = this.pendingTools.get(requestId);
    if (!pending || pending.clusterId !== clusterId) {
      return fail("tool_result", `No pending tool request ${requestId}`);
    }
    this.pendingTools.delete(requestId);
    if (isError) {
      pending.reject(new Error(text));
    } else {
      pending.resolve(text);
    }
    return ok("tool_result");
  }

  private uiResponse(clusterId: string, id: string, confirmed: boolean): AgentResponse {
    const pending = this.pendingApprovals.get(id);
    if (!pending || pending.clusterId !== clusterId) {
      return fail("ui_response", `No pending approval ${id}`);
    }
    pending.settle(confirmed === true);
    return ok("ui_response");
  }

  // pi's `tool_call` hook: a call that needs approval is validated and
  // prepared, the prepared input replaces the model's in place, and the run
  // waits for the user. pi asks for one call at a time. A run aborted some
  // other way than our Stop denies the approval too, so the hook never hangs.
  private async gate(
    clusterId: string,
    event: ToolCallEvent,
    signal: AbortSignal | undefined,
  ): Promise<ToolCallEventResult | undefined> {
    const tool = this.options.tools.find((candidate) => candidate.name === event.toolName);
    const requiresApproval = this.options.requiresApproval ?? ((definition) => definition.requiresApprovalByDefault);
    if (!tool || !requiresApproval(tool)) return undefined;

    const input = event.input as Record<string, unknown>;
    const prepared = prepareApproval(tool.name, input);
    if (!prepared.ok) {
      return { block: true, reason: prepared.error };
    }
    for (const key of Object.keys(input)) delete input[key];
    Object.assign(input, prepared.input);

    const agent = await this.clusters.get(clusterId);
    if (!agent) return { block: true, reason: "The cluster session is not available." };
    const request: ApprovalRequest = {
      id: randomUUID(),
      toolCallId: event.toolCallId,
      method: "confirm",
      title: prepared.title,
      message: prepared.message,
      approval: prepared.approval,
    };
    if (signal?.aborted) return { block: true, reason: DENIED_REASON };
    const confirmed = await new Promise<boolean>((resolve) => {
      const onAbort = () => settle(false);
      const settle = (answer: boolean) => {
        if (!this.pendingApprovals.delete(request.id)) return;
        signal?.removeEventListener("abort", onAbort);
        this.send(clusterId, agent, { kind: "ui_resolved", payload: { id: request.id, confirmed: answer } });
        resolve(answer);
      };
      this.pendingApprovals.set(request.id, { clusterId, request, settle });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.send(clusterId, agent, { kind: "ui_request", payload: request });
    });
    return confirmed ? undefined : { block: true, reason: DENIED_REASON };
  }

  // The model is optional: a snapshot opens the session before a prompt has
  // chosen one, and the prompt then sets it.
  private getClusterAgent(clusterId: string, model?: Model<any>): Promise<ClusterAgent> {
    let agent = this.clusters.get(clusterId);
    if (!agent) {
      agent = this.createClusterAgent(clusterId, model);
      this.clusters.set(clusterId, agent);
      agent.catch(() => this.clusters.delete(clusterId));
    }
    return agent;
  }

  private async createClusterAgent(clusterId: string, model: Model<any> | undefined): Promise<ClusterAgent> {
    const { dataDir, modelRuntime, tools } = this.options;
    const sessionDir = this.sessionDir(clusterId);
    const agentDir = join(dataDir, "pi");
    const markerPath = join(sessionDir, NEW_CHAT_MARKER);
    mkdirSync(sessionDir, { recursive: true });

    // Only our own prompt and tools: no pi coding prompt, context files,
    // skills, prompt templates or extensions loaded from disk.
    const resourceLoader = new DefaultResourceLoader({
      cwd: sessionDir,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: this.options.systemPrompt ?? SYSTEM_PROMPT,
      extensionFactories: [
        (pi) => {
          for (const tool of tools) {
            pi.registerTool(this.toPiTool(clusterId, tool));
          }
          pi.on("tool_call", (event, ctx) => this.gate(clusterId, event, ctx.signal));
        },
      ],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: sessionDir,
      agentDir,
      model,
      thinkingLevel: "medium",
      modelRuntime,
      resourceLoader,
      noTools: "builtin",
      // One active chat per cluster: continue its latest session file, unless
      // New chat left its marker.
      sessionManager: existsSync(markerPath)
        ? SessionManager.create(sessionDir, sessionDir)
        : SessionManager.continueRecent(sessionDir, sessionDir),
      settingsManager: SettingsManager.inMemory(this.options.retry === false ? { retry: { enabled: false } } : {}),
    });

    const agent: ClusterAgent = { session };
    session.subscribe((event) => {
      // Repeats message_end and can carry large tool results.
      if (event.type === "entry_appended") return;
      // pi writes the file with the first saved message, so the marker is done.
      // pi saves a message right after telling its listeners, hence the microtask.
      if (event.type === "message_end") {
        queueMicrotask(() => {
          if (session.sessionFile && existsSync(session.sessionFile)) rmSync(markerPath, { force: true });
        });
      }
      this.send(clusterId, agent, { kind: "event", payload: toJsonEvent(event) });
    });
    return agent;
  }

  // Fire and forget: the session listener never waits on the frames, and a
  // failing broadcast must not break the run.
  private send(clusterId: string, agent: ClusterAgent, body: Pick<AgentEnvelope, "kind" | "payload">): void {
    const seq = (this.seqs.get(clusterId) ?? 0) + 1;
    this.seqs.set(clusterId, seq);
    try {
      this.options.broadcast({ clusterId, sessionId: agent.session.sessionId, seq, ...body } as AgentEnvelope);
    } catch (error) {
      console.error(`[freelens-ai] Broadcasting to the frames of cluster ${clusterId} failed:`, error);
    }
  }

  private toPiTool(clusterId: string, tool: AgentToolDefinition) {
    return defineTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      executionMode: tool.mutating ? "sequential" : undefined,
      execute: async (_toolCallId, params, signal) => {
        const text = await this.requestTool(clusterId, tool.name, params as Record<string, unknown>, signal);
        return { content: [{ type: "text", text }], details: undefined };
      },
    });
  }

  // Sends the call to the cluster frame and waits for its `tool_result`. A
  // closed frame or a disconnected cluster must not stall the run, so the wait
  // times out into an error the model sees.
  private async requestTool(
    clusterId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const agent = await this.clusters.get(clusterId);
    if (!agent) throw new Error("The cluster session is not available.");
    const timeoutMs = this.options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const requestId = randomUUID();

    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.pendingTools.delete(requestId);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("The tool call was aborted."));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `The cluster window did not answer the ${toolName} call within ${Math.round(timeoutMs / 1000)} seconds. ` +
              "The cluster may be disconnected or its window closed. If the call changes the cluster, it may still " +
              "have been applied: check the resource's current state before trying again.",
          ),
        );
      }, timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      const request: ToolRequest = { requestId, toolName, args };
      this.pendingTools.set(requestId, {
        clusterId,
        request,
        resolve: (text) => {
          cleanup();
          resolve(text);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });

      this.send(clusterId, agent, { kind: "tool_request", payload: request });
    });
  }
}
