import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { toJsonEvent } from "./json-event";
import { SYSTEM_PROMPT } from "./system-prompt";

import type { Model } from "@earendil-works/pi-ai";

import type { AgentCommand, AgentEnvelope, AgentResponse, ToolRequest } from "../../common/agent-protocol";
import type { AgentToolDefinition } from "../../common/agent-tools";

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

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
  systemPrompt?: string;
  toolTimeoutMs?: number;
  /** pi retries temporary provider errors; tests turn that off. */
  retry?: boolean;
}

interface ClusterAgent {
  session: AgentSession;
  seq: number;
}

interface PendingToolRequest {
  clusterId: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

const ok = (command: string, data?: unknown): AgentResponse => ({ type: "response", command, success: true, data });
const fail = (command: string, error: string): AgentResponse => ({ type: "response", command, success: false, error });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

  constructor(private readonly options: AgentHostOptions) {}

  async handleCommand(clusterId: string, command: AgentCommand): Promise<AgentResponse> {
    switch (command.type) {
      case "prompt":
        return this.prompt(clusterId, command.message);
      case "tool_result":
        return this.toolResult(clusterId, command.requestId, command.text, command.isError ?? false);
      default:
        return fail((command as { type?: string }).type ?? "unknown", "Unknown command");
    }
  }

  dispose(): void {
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

  private getClusterAgent(clusterId: string, model: Model<any>): Promise<ClusterAgent> {
    let agent = this.clusters.get(clusterId);
    if (!agent) {
      agent = this.createClusterAgent(clusterId, model);
      this.clusters.set(clusterId, agent);
      agent.catch(() => this.clusters.delete(clusterId));
    }
    return agent;
  }

  private async createClusterAgent(clusterId: string, model: Model<any>): Promise<ClusterAgent> {
    const { dataDir, modelRuntime, tools } = this.options;
    const sessionDir = join(dataDir, "sessions", safeFolderName(clusterId));
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

    const agent: ClusterAgent = { session, seq: 0 };
    session.subscribe((event) => {
      // Repeats message_end and can carry large tool results.
      if (event.type === "entry_appended") return;
      this.send(clusterId, agent, { kind: "event", payload: toJsonEvent(event) });
    });
    return agent;
  }

  private send(clusterId: string, agent: ClusterAgent, body: Pick<AgentEnvelope, "kind" | "payload">): void {
    agent.seq += 1;
    this.options.broadcast({
      clusterId,
      sessionId: agent.session.sessionId,
      seq: agent.seq,
      ...body,
    } as AgentEnvelope);
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
      this.pendingTools.set(requestId, {
        clusterId,
        resolve: (text) => {
          cleanup();
          resolve(text);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });

      const request: ToolRequest = { requestId, toolName, args };
      this.send(clusterId, agent, { kind: "tool_request", payload: request });
    });
  }
}
