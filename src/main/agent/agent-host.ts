import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
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

  constructor(private readonly options: AgentHostOptions) {}

  async handleCommand(clusterId: string, command: AgentCommand): Promise<AgentResponse> {
    switch (command.type) {
      case "prompt":
        return this.prompt(clusterId, command.message);
      case "abort":
        return this.abort(clusterId);
      case "get_snapshot":
        return this.snapshot(clusterId);
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

    let agent: ClusterAgent;
    try {
      agent = await this.getClusterAgent(clusterId, model);
      const current = agent.session.model;
      if (current?.provider !== model.provider || current?.id !== model.id) {
        await agent.session.setModel(model);
      }
    } catch (error) {
      return fail("prompt", errorText(error));
    }

    // Answer as soon as pi accepted the prompt; the run itself streams as
    // events, and a failure during the run arrives as an event too.
    return new Promise<AgentResponse>((resolve) => {
      let answered = false;
      const answer = (response: AgentResponse) => {
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
  // waits for the user. pi asks for one call at a time.
  private async gate(clusterId: string, event: ToolCallEvent): Promise<ToolCallEventResult | undefined> {
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
    const confirmed = await new Promise<boolean>((resolve) => {
      this.pendingApprovals.set(request.id, {
        clusterId,
        request,
        settle: (answer) => {
          if (!this.pendingApprovals.delete(request.id)) return;
          this.send(clusterId, agent, { kind: "ui_resolved", payload: { id: request.id, confirmed: answer } });
          resolve(answer);
        },
      });
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
          pi.on("tool_call", (event) => this.gate(clusterId, event));
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
      // One active chat per cluster: continue its latest session file.
      sessionManager: SessionManager.continueRecent(sessionDir, sessionDir),
      settingsManager: SettingsManager.inMemory(this.options.retry === false ? { retry: { enabled: false } } : {}),
    });

    const agent: ClusterAgent = { session };
    session.subscribe((event) => {
      // Repeats message_end and can carry large tool results.
      if (event.type === "entry_appended") return;
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
              "The cluster may be disconnected or its window closed.",
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
