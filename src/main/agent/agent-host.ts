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
import {
  DEFAULT_CHAT_RETENTION_DAYS,
  errorText,
  failureResponse,
  isCliApprovalRequest,
  successResponse,
} from "../../common/agent-protocol";
import { prepareApproval } from "../../common/agent-tools/approval";
import { kubectlTool } from "../../common/agent-tools/kubectl-tool";
import { DRY_RUN_VERBS } from "../../common/invocation-policy/dry-run-verbs";
import {
  evaluateInvocationPolicy,
  type InvocationPolicyResult,
} from "../../common/invocation-policy/invocation-policy";
import { clusterPolicyProfile, type PolicyProfileSettings } from "../../common/invocation-policy/profile-assignment";
import { DEFAULT_THINKING_LEVEL, type ThinkingLevel } from "../../common/thinking-level";
import useLog from "../utils/logger";
import { toJsonEvent } from "./json-event";
import { cliPolicySection, EXPLAIN_PROMPT, SYSTEM_PROMPT, withUserRules } from "./system-prompt";
import { hasApprovalBackup, loadApprovalBackup } from "./tools/approval-backup";
import {
  type ClusterReadContext,
  type ClusterResources,
  readDefaultNamespace,
  readResourceCatalog,
} from "./tools/cluster-resources";
import { describeRequestError } from "./tools/describe-request-error";
import { type KubectlToolInput, prepareKubectlInvocation, runKubectl } from "./tools/kubectl";
import { dryRunRejectionReason, floorBlockReason, profileDenyReason } from "./tools/kubectl-policy";
import { previewKubectlInvocation } from "./tools/kubectl-preview";
import { READ_TOOL_RUNNERS } from "./tools/read-tools";
import { planSecretRedaction, type SecretRedaction } from "./tools/secret-redaction";
import { WRITE_TOOL_RUNNERS } from "./tools/write-tools";

import type { Model } from "@earendil-works/pi-ai";

import type {
  AgentCommand,
  AgentEnvelope,
  AgentResponse,
  AgentSnapshot,
  ApprovalRequest,
  ApprovalTarget,
  ChatMessage,
  CliApprovalPreview,
  CliApprovalRequest,
  TranscriptEntry,
} from "../../common/agent-protocol";
import type { AgentToolDefinition } from "../../common/agent-tools";
import type { PolicyProfile } from "../../common/invocation-policy/policy-profile";
import type { CliRunner } from "./cli-runner";
import type { ClusterToolRunner, KubeJsonApi } from "./tools/cluster-api";

const { log } = useLog("freelens-ai");

export const DENIED_REASON = "The user denied the action";
const CLUSTER_NOT_CONNECTED = "Cluster not connected";
// `ClusterConnectionStatus.CONNECTED` of the host's catalog.
const CONNECTED = "connected";
const DAY_MS = 24 * 60 * 60 * 1000;
// Left in a cluster's session folder by New chat until the new chat has a
// file, so a restart in between does not reopen the chat the user left.
const NEW_CHAT_MARKER = ".new-chat";
// pi's adapters for these APIs throw "Custom fetch is not supported", so their
// requests keep pi's default fetch.
const APIS_WITHOUT_CUSTOM_FETCH: ReadonlySet<string> = new Set(["google-generative-ai", "google-vertex"]);
// Every cluster tool runs here in main, by its shared name.
const CLUSTER_TOOL_RUNNERS: Readonly<Record<string, ClusterToolRunner>> = {
  ...READ_TOOL_RUNNERS,
  ...WRITE_TOOL_RUNNERS,
};

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
  /**
   * The cluster's connection status in the Freelens catalog, undefined for a
   * cluster Freelens does not know; read before every tool call and backup load.
   */
  getClusterStatus: (clusterId: string) => string | undefined;
  /** The host's JSON client of a cluster, which the tools and the approval backups send their requests with. */
  getClusterApi: (clusterId: string) => KubeJsonApi;
  /** Runs the CLI invocations of the kubectl tool against a cluster. */
  runCli: CliRunner;
  /**
   * The policy profiles, their assignments to clusters and the default profile,
   * which give each kubectl call the policy level of its cluster's profile;
   * read before every call and every prompt, so a change applies to the next
   * one. A change also calls for `recheckPendingApprovals()`.
   */
  getPolicyProfileSettings: () => PolicyProfileSettings;
  /** The "pod logs tail lines" preference; read before every pod logs call. */
  getPodLogsTailLines: () => number;
  /** The model the next prompt runs on, or undefined when none is selected. */
  getModelRef: () => ModelRef | undefined;
  /** The global thinking level; read before every prompt, and pi clamps it to what the model supports. */
  getThinkingLevel?: () => ThinkingLevel;
  /** The user's custom agent rules; read before every prompt and explanation. Empty sets no section. */
  getUserRules?: () => string;
  /** The cluster's name as Freelens shows it; read before every prompt. Undefined sets no section. */
  getClusterName?: (clusterId: string) => string | undefined;
  /**
   * The HTTP client for pi's model requests (the host's `Main.Util.fetch`, which
   * applies the Freelens proxy and CA settings). Undefined keeps pi's default,
   * Node's global `fetch`.
   */
  fetch?: typeof fetch;
  systemPrompt?: string;
  /** pi retries temporary provider errors; tests turn that off. */
  retry?: boolean;
  /** pi's compaction thresholds for the chats; tests lower them to make pi compact. */
  compaction?: { reserveTokens: number; keepRecentTokens: number };
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
  // "Approve all in this chat": in memory only, so New chat, Delete all chats
  // and a restart, which all drop this object, turn it off. It covers Ask
  // calls only, never Always ask.
  autoApprove: boolean;
  // The resources and the namespace of the cluster, read before the chat's
  // first kubectl call and kept for its session; the resources are read again
  // when a call names one they lack.
  clusterResources?: ClusterResources;
  // The kubectl calls the gate let through, by tool call id, until they run:
  // a call runs only after the gate, with what the policy decided about it.
  passedKubectlCalls: Map<string, PassedKubectlCall>;
}

interface PassedKubectlCall {
  secretRedaction?: SecretRedaction;
}

// An AI Explain run: a throwaway pi session that is never saved. Registered
// before its session exists, so a second explanation or a prompt sent while it
// starts is refused, and Stop can cancel it before it runs.
interface ExplainRun {
  session?: AgentSession;
  cancelled: boolean;
  /** The frames got agent_start and not yet agent_settled. */
  running: boolean;
  /** Settles once pi started the run or the explanation ended without one. */
  started: Promise<void>;
}

interface PendingApproval {
  clusterId: string;
  request: ApprovalRequest;
  /** Settles the approval; a denial blocks the call with `reason`, the user's denial by default. */
  settle: (confirmed: boolean, reason?: string) => void;
  /** For a kubectl call: the reason to block it under the cluster's profile as it is now, or undefined. */
  blockReasonNow?: () => string | undefined;
}

// The policy's result for a kubectl call with the agent's own arguments, before
// the tool adds `-f -` or a logs tail.
const evaluateKubectlWith = (
  input: KubectlToolInput,
  profile: PolicyProfile,
  { catalog, defaultNamespace }: ClusterResources,
): InvocationPolicyResult =>
  evaluateInvocationPolicy({
    program: "kubectl",
    args: input.args,
    ...(input.manifest === undefined ? {} : { manifest: input.manifest }),
    revealSecrets: input.revealSecrets === true,
    profile,
    catalog,
    defaultNamespace,
  });

// Why a kubectl call is blocked: the floor entry or the profile's Deny; undefined for any other level.
const kubectlBlockReason = (profile: PolicyProfile, decision: InvocationPolicyResult): string | undefined => {
  if (decision.kind === "floor") return floorBlockReason(decision);
  return decision.level === "deny" ? profileDenyReason(profile, decision) : undefined;
};

// The chat shows only these, the tool results under their calls; pi's system
// prompt and custom entries stay in main.
const isChatMessage = (message: { role: string }): message is ChatMessage =>
  message.role === "user" || message.role === "assistant" || message.role === "toolResult";

// The chat as the user saw it, from the saved entries rather than
// `session.messages`: after a compaction those hold only what the model still
// sees, which would drop the earlier part of the chat on a rebuild.
const transcript = (session: AgentSession): TranscriptEntry[] =>
  session.sessionManager.getBranch().flatMap((entry): TranscriptEntry[] => {
    if (entry.type === "message") return isChatMessage(entry.message) ? [entry.message] : [];
    if (entry.type === "compaction") return [{ role: "compaction", timestamp: Date.parse(entry.timestamp) }];
    return [];
  });

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
  // No timeout: an approval waits until the user answers or stops the run.
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  // Per cluster rather than per session, so a snapshot taken before the first
  // run reports 0.
  private readonly seqs = new Map<string, number>();
  // New chat or Delete all chats in progress, per cluster.
  private readonly resets = new Map<string, Promise<AgentResponse>>();
  // Prompts that pi has not started running yet, per cluster.
  private readonly preparing = new Map<string, Set<Promise<void>>>();
  // The running AI Explain, per cluster.
  private readonly explains = new Map<string, ExplainRun>();

  constructor(private readonly options: AgentHostOptions) {}

  async handleCommand(clusterId: string, command: AgentCommand): Promise<AgentResponse> {
    switch (command.type) {
      case "prompt":
        return this.prompt(clusterId, command.message);
      case "explain":
        return this.explain(clusterId, command.message);
      case "abort":
        return this.abort(clusterId);
      case "get_snapshot":
        return this.snapshot(clusterId);
      case "get_session_stats":
        return this.sessionStats(clusterId);
      case "new_session":
      case "delete_sessions":
        return this.resetChat(clusterId, command.type);
      case "ui_response":
        return this.uiResponse(clusterId, command.id, command.confirmed, command.approveAll === true);
      case "set_auto_approve":
        return this.turnOffAutoApprove(clusterId);
      default:
        return failureResponse((command as { type?: string }).type ?? "unknown", "Unknown command");
    }
  }

  /**
   * Checks every pending kubectl approval again under the profile of its
   * cluster as it is now: one the profile now denies is denied with the
   * reason, and any other stays pending until the user answers. Main calls it
   * when a profile, an assignment or the default profile changes.
   */
  recheckPendingApprovals(): void {
    for (const pending of [...this.pendingApprovals.values()]) {
      const reason = pending.blockReasonNow?.();
      if (reason !== undefined) pending.settle(false, reason);
    }
  }

  dispose(): void {
    for (const pending of [...this.pendingApprovals.values()]) {
      pending.settle(false);
    }
    for (const cluster of this.clusters.values()) {
      cluster.then((agent) => agent.session.dispose()).catch(() => undefined);
    }
    this.clusters.clear();
    for (const run of this.explains.values()) {
      run.cancelled = true;
      run.session?.dispose();
    }
    this.explains.clear();
  }

  // The selected model, or the reason a prompt or an explanation can't run.
  private async selectedModel(command: string): Promise<Model<any> | AgentResponse> {
    const ref = this.options.getModelRef();
    if (!ref) {
      return failureResponse(command, "No model is selected. Choose a model for the chat first.");
    }
    const model = this.options.modelRuntime.getModel(ref.provider, ref.id);
    if (!model) {
      return failureResponse(command, `The model ${ref.provider}/${ref.id} is not available.`);
    }
    if (!(await this.options.modelRuntime.checkAuth(model.provider))) {
      return failureResponse(
        command,
        `No credentials for ${model.provider}. Add an API key or sign in to ${model.provider} in the Freelens AI settings.`,
      );
    }
    return model;
  }

  private async prompt(clusterId: string, message: string): Promise<AgentResponse> {
    const model = await this.selectedModel("prompt");
    if ("success" in model) return model;
    if (this.explains.has(clusterId)) {
      return failureResponse("prompt", "Wait for the explanation to finish, or stop it, before sending a message.");
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
      // Set on every prompt: pi clamps the level to the current model, so after
      // a model without reasoning the session holds "off", not the user's choice.
      agent.session.setThinkingLevel(this.thinkingLevel());
    } catch (error) {
      prepared();
      return failureResponse("prompt", errorText(error));
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
        .prompt(message, { preflightResult: (disposition) => answer(successResponse("prompt", { disposition })) })
        .then(() => answer(successResponse("prompt")))
        .catch((error) => {
          if (answered) {
            // Run errors normally arrive as events; this one escaped them.
            log.error(`The agent run for cluster ${clusterId} failed:`, error);
          }
          answer(failureResponse("prompt", errorText(error)));
        });
    });
  }

  // AI Explain runs in a throwaway in-memory session with the explain prompt
  // and no tools, so the answer never grows the chat's context or its file.
  // Its events go out like the chat's, under the explain session's id.
  private async explain(clusterId: string, message: string): Promise<AgentResponse> {
    if (!message.trim()) return failureResponse("explain", "Nothing to explain.");
    if (this.explains.has(clusterId)) {
      return failureResponse("explain", "An explanation is already running. Wait for it to finish, or stop it.");
    }

    // Registered before any await, so a second explanation is refused and Stop
    // finds it.
    let markStarted!: () => void;
    const run: ExplainRun = {
      cancelled: false,
      running: false,
      started: new Promise<void>((resolve) => {
        markStarted = resolve;
      }),
    };
    this.explains.set(clusterId, run);
    const release = () => {
      markStarted();
      if (this.explains.get(clusterId) === run) this.explains.delete(clusterId);
    };
    const finish = () => {
      release();
      run.session?.dispose();
    };

    const model = await this.selectedModel("explain");
    if ("success" in model) {
      finish();
      return model;
    }
    const chat = await this.clusters.get(clusterId)?.catch(() => undefined);
    if (chat?.session.isStreaming || this.preparing.has(clusterId) || this.resets.has(clusterId)) {
      finish();
      return failureResponse(
        "explain",
        "Wait for the current answer to finish, or stop it, before asking for an explanation.",
      );
    }

    let session: AgentSession;
    try {
      const { dataDir, modelRuntime } = this.options;
      const cwd = this.sessionDir(clusterId);
      const agentDir = join(dataDir, "pi");
      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: withUserRules(EXPLAIN_PROMPT, this.options.getUserRules?.()),
      });
      await resourceLoader.reload();
      ({ session } = await createAgentSession({
        cwd,
        agentDir,
        model,
        thinkingLevel: this.thinkingLevel(),
        modelRuntime,
        resourceLoader,
        noTools: "builtin",
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager: SettingsManager.inMemory(this.options.retry === false ? { retry: { enabled: false } } : {}),
      }));
    } catch (error) {
      finish();
      return failureResponse("explain", errorText(error));
    }
    this.useInjectedFetch(session);
    run.session = session;
    // Stop or New chat while the session was being created: nothing ran.
    if (run.cancelled) {
      finish();
      return successResponse("explain", { disposition: "cancelled" });
    }

    session.subscribe((event) => {
      if (event.type === "entry_appended") return;
      // Snapshots report the explanation as running only between the frames'
      // agent_start and agent_settled, so a run that never starts can't leave
      // a remounted frame stuck.
      if (event.type === "agent_start") {
        run.running = true;
        // A Stop that came while pi was still starting the run.
        if (run.cancelled) void session.abort();
      }
      this.send(clusterId, session.sessionId, { kind: "event", payload: toJsonEvent(event) });
      // Settled before the prompt's promise resolves: a prompt sent right after
      // the answer ends is not refused.
      if (event.type === "agent_settled") release();
    });

    return new Promise<AgentResponse>((resolve) => {
      let answered = false;
      const answer = (response: AgentResponse) => {
        markStarted();
        if (!answered) {
          answered = true;
          resolve(response);
        }
      };
      session
        .prompt(message, { preflightResult: (disposition) => answer(successResponse("explain", { disposition })) })
        .then(() => answer(successResponse("explain")))
        .catch((error) => {
          if (answered) {
            log.error(`The explanation for cluster ${clusterId} failed:`, error);
          }
          answer(failureResponse("explain", errorText(error)));
        })
        .finally(finish);
    });
  }

  // Until pi starts the run, its abort does nothing, so this waits for the
  // explanation to get that far, as New chat does for a chat prompt.
  private async stopExplain(clusterId: string): Promise<void> {
    const run = this.explains.get(clusterId);
    if (!run) return;
    run.cancelled = true;
    await run.started;
    await run.session?.abort();
  }

  // Stop first denies a pending approval, which pi's abort would wait on. The
  // abort then cancels the cluster request in progress through pi's signal.
  private async abort(clusterId: string): Promise<AgentResponse> {
    try {
      await this.stopExplain(clusterId);
    } catch (error) {
      return failureResponse("abort", errorText(error));
    }
    const agent = this.clusters.get(clusterId);
    if (!agent) return successResponse("abort");
    for (const pending of [...this.pendingApprovals.values()]) {
      if (pending.clusterId === clusterId) pending.settle(false);
    }
    try {
      await (await agent).session.abort();
      return successResponse("abort");
    } catch (error) {
      return failureResponse("abort", errorText(error));
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
          log.error(`Deleting the old chat ${session.path} failed:`, error);
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
      return failureResponse(command, errorText(error));
    }
    if (command === "new_session") {
      try {
        await this.pruneSessions();
      } catch (error) {
        log.error("Deleting old chats failed:", error);
      }
    }
    const snapshot = await this.snapshot(clusterId);
    return snapshot.success ? successResponse(command, snapshot.data) : failureResponse(command, snapshot.error);
  }

  private async closeClusterAgent(clusterId: string): Promise<void> {
    await this.stopExplain(clusterId);
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
    // A running explanation keeps Stop on a remounted frame. Its partial answer
    // is left out: it is not part of the chat, and rebuilding the chat around
    // it would drop the frame's earlier explanations.
    const explaining = () => this.explains.get(clusterId)?.running === true;
    const empty: AgentSnapshot = {
      messages: [],
      isStreaming: explaining(),
      autoApprove: false,
      seq: this.seqs.get(clusterId) ?? 0,
    };
    // Opening a session for a cluster that never chatted would create files.
    if (!this.clusters.has(clusterId) && !this.hasSessionFile(clusterId)) {
      return successResponse("get_snapshot", empty);
    }
    try {
      const { session, autoApprove } = await this.getClusterAgent(clusterId);
      // Read seq together with the state, after the await, so they match.
      const streaming = session.state.streamingMessage;
      const snapshot: AgentSnapshot = {
        ...empty,
        seq: this.seqs.get(clusterId) ?? 0,
        sessionId: session.sessionId,
        messages: transcript(session),
        streamingMessage: streaming?.role === "assistant" ? streaming : undefined,
        isStreaming: session.isStreaming || explaining(),
        pendingUiRequest: [...this.pendingApprovals.values()].find((pending) => pending.clusterId === clusterId)
          ?.request,
        autoApprove,
        stats: session.getSessionStats(),
      };
      return successResponse("get_snapshot", snapshot);
    } catch (error) {
      return failureResponse("get_snapshot", errorText(error));
    }
  }

  private async sessionStats(clusterId: string): Promise<AgentResponse> {
    // Opening a session for a cluster that never chatted would create files.
    if (!this.clusters.has(clusterId) && !this.hasSessionFile(clusterId)) {
      return successResponse("get_session_stats");
    }
    try {
      const { session } = await this.getClusterAgent(clusterId);
      return successResponse("get_session_stats", session.getSessionStats());
    } catch (error) {
      return failureResponse("get_session_stats", errorText(error));
    }
  }

  private sessionDir(clusterId: string): string {
    return join(this.options.dataDir, "sessions", safeFolderName(clusterId));
  }

  private hasSessionFile(clusterId: string): boolean {
    const dir = this.sessionDir(clusterId);
    return existsSync(dir) && readdirSync(dir).some((file) => file.endsWith(".jsonl"));
  }

  private async uiResponse(
    clusterId: string,
    id: string,
    confirmed: boolean,
    approveAll: boolean,
  ): Promise<AgentResponse> {
    const pending = this.pendingApprovals.get(id);
    if (!pending || pending.clusterId !== clusterId) {
      return failureResponse("ui_response", `No pending approval ${id}`);
    }
    // An Always ask approval never turns it on, so it cannot cover a later Always ask.
    const coversLaterCalls = !isCliApprovalRequest(pending.request) || pending.request.level === "ask";
    if (confirmed === true && approveAll && coversLaterCalls) {
      const agent = await this.clusters.get(clusterId)?.catch(() => undefined);
      // Turned on before the call is released, so the next gated call already
      // skips the card. Stop may have denied the approval meanwhile.
      if (!agent || !this.pendingApprovals.has(id)) return failureResponse("ui_response", `No pending approval ${id}`);
      this.setAutoApprove(clusterId, agent, true);
    }
    pending.settle(confirmed === true);
    return successResponse("ui_response");
  }

  private async turnOffAutoApprove(clusterId: string): Promise<AgentResponse> {
    const agent = await this.clusters.get(clusterId)?.catch(() => undefined);
    if (agent) this.setAutoApprove(clusterId, agent, false);
    return successResponse("set_auto_approve");
  }

  private setAutoApprove(clusterId: string, agent: ClusterAgent, enabled: boolean): void {
    if (agent.autoApprove === enabled) return;
    agent.autoApprove = enabled;
    this.send(clusterId, agent.session.sessionId, { kind: "auto_approve", payload: { enabled } });
  }

  // pi's `tool_call` hook. A kubectl call goes through the invocation policy.
  // For the other tools, a call of a tool that requires approval by default,
  // and every write call, is
  // validated and prepared, and the prepared input replaces the model's in
  // place: the write tools apply their input as it comes. A call that needs
  // approval then waits for the user, with the backup of the object it would
  // change on the card. pi asks for one call at a time.
  private async gate(
    clusterId: string,
    event: ToolCallEvent,
    signal: AbortSignal | undefined,
  ): Promise<ToolCallEventResult | undefined> {
    const tool = this.options.tools.find((candidate) => candidate.name === event.toolName);
    if (!tool) return undefined;
    if (tool.name === kubectlTool.name) return this.gateKubectl(clusterId, event, signal);
    const ask = tool.requiresApprovalByDefault;
    if (!ask && !tool.mutating) return undefined;

    const input = event.input as Record<string, unknown>;
    const prepared = prepareApproval(tool.name, input);
    if (!prepared.ok) {
      return { block: true, reason: prepared.error };
    }
    // Copied first: for some tools the prepared input is the model's object itself.
    const next = { ...prepared.input };
    for (const key of Object.keys(input)) delete input[key];
    Object.assign(input, next);
    if (!ask) return undefined;

    const agent = await this.clusters.get(clusterId);
    if (!agent) return { block: true, reason: "The cluster session is not available." };
    // "Approve all in this chat": validated and prepared as above, but not asked.
    if (agent.autoApprove) return undefined;
    const backup = await this.approvalBackup(clusterId, prepared.approval, signal);
    return this.askUser(clusterId, agent, signal, {
      id: randomUUID(),
      toolCallId: event.toolCallId,
      method: "confirm",
      title: prepared.title,
      message: prepared.message,
      approval: prepared.approval,
      ...(backup ? { backup } : {}),
    });
  }

  // The invocation policy decides every kubectl call with the cluster's
  // profile: the floor and Deny block it with the reason, Allow runs it, Ask
  // asks unless "Approve all in this chat" is on, and Always ask always asks.
  private async gateKubectl(
    clusterId: string,
    event: ToolCallEvent,
    signal: AbortSignal | undefined,
  ): Promise<ToolCallEventResult | undefined> {
    // Not even the gate's own invocations start for a cluster that is not connected.
    if (this.options.getClusterStatus(clusterId) !== CONNECTED) return { block: true, reason: CLUSTER_NOT_CONNECTED };
    const input = event.input as unknown as KubectlToolInput;
    const prepared = prepareKubectlInvocation(input, this.options.getPodLogsTailLines());
    if (!prepared.ok) return { block: true, reason: prepared.error };
    const agent = await this.clusters.get(clusterId);
    if (!agent) return { block: true, reason: "The cluster session is not available." };

    const profile = this.policyProfile(clusterId);
    const read: ClusterReadContext = {
      clusterId,
      runCli: this.options.runCli,
      signal,
      // The kubectl download, if any, happens in the gate's first invocation:
      // it shows on the call's card as the tool's own progress does.
      onProgress: (text) =>
        this.send(clusterId, agent.session.sessionId, {
          kind: "event",
          payload: {
            type: "tool_execution_update",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            partialResult: { content: [{ type: "text", text }] },
          },
        }),
    };
    let decision: InvocationPolicyResult;
    try {
      decision = await this.evaluateKubectl(agent, input, profile, read);
    } catch (error) {
      return { block: true, reason: `Could not read the resources the cluster serves: ${errorText(error)}` };
    }
    if (decision.kind === "floor") return { block: true, reason: floorBlockReason(decision) };
    if (decision.level === "deny") return { block: true, reason: profileDenyReason(profile, decision) };
    const secretRedaction = planSecretRedaction(input.args, decision.targets);
    const pass = () => {
      agent.passedKubectlCalls.set(event.toolCallId, secretRedaction ? { secretRedaction } : {});
      return undefined;
    };
    if (decision.level === "allow") return pass();
    if (decision.level === "ask" && agent.autoApprove) return pass();

    // Before asking, the server's dry run of a verb that has one: a change the
    // server rejects fails without a card, with the server's message.
    const dryRunVerb = DRY_RUN_VERBS.kubectl.find((verb) =>
      decision.targets.some((target) => target.form.verb === verb.verb),
    );
    let preview: CliApprovalPreview | undefined;
    if (dryRunVerb && agent.clusterResources) {
      const outcome = await previewKubectlInvocation(read, {
        args: prepared.args,
        ...(prepared.manifest === undefined ? {} : { manifest: prepared.manifest }),
        verb: dryRunVerb,
        targets: decision.targets.map((target) => target.form),
        catalog: agent.clusterResources.catalog,
      });
      if (outcome.kind === "stopped") return { block: true, reason: DENIED_REASON };
      if (outcome.kind === "rejected") return { block: true, reason: dryRunRejectionReason(outcome.message) };
      preview = outcome.preview;
    }

    const request: CliApprovalRequest = {
      id: randomUUID(),
      toolCallId: event.toolCallId,
      method: "confirm",
      program: "kubectl",
      args: [...input.args],
      ...(input.manifest === undefined ? {} : { manifest: input.manifest }),
      canonicalForms: decision.targets.map((target) => target.form),
      level: decision.level,
      profileName: profile.name,
      ...(preview ? { preview } : {}),
    };
    // The resources read for this call stay on the agent, so the call is
    // evaluated again with them when the profiles change.
    const blockReasonNow = () => {
      const current = this.policyProfile(clusterId);
      const resources = agent.clusterResources;
      return resources && kubectlBlockReason(current, evaluateKubectlWith(input, current, resources));
    };
    return (await this.askUser(clusterId, agent, signal, request, blockReasonNow)) ?? pass();
  }

  // The policy's result for a kubectl call, with the agent's own arguments,
  // before the tool adds `-f -` or a logs tail. A resource the catalog lacks
  // may have been added to the cluster since it was read, so the catalog is
  // read again once, unless it was read for this very call.
  private async evaluateKubectl(
    agent: ClusterAgent,
    input: KubectlToolInput,
    profile: PolicyProfile,
    read: ClusterReadContext,
  ): Promise<InvocationPolicyResult> {
    const evaluate = (resources: ClusterResources) => evaluateKubectlWith(input, profile, resources);
    const known = agent.clusterResources;
    if (!known) {
      const catalog = await readResourceCatalog(read);
      agent.clusterResources = { catalog, defaultNamespace: await readDefaultNamespace(read) };
      return evaluate(agent.clusterResources);
    }
    const decision = evaluate(known);
    if (decision.kind !== "floor" || decision.entry.id !== "unknown-resource") return decision;
    agent.clusterResources = { ...known, catalog: await readResourceCatalog(read) };
    return evaluate(agent.clusterResources);
  }

  private policyProfile(clusterId: string): PolicyProfile {
    return clusterPolicyProfile(this.options.getPolicyProfileSettings(), clusterId);
  }

  // Waits for the user's answer to an approval request. A run aborted some
  // other way than our Stop denies the approval too, so the hook never hangs.
  private async askUser(
    clusterId: string,
    agent: ClusterAgent,
    signal: AbortSignal | undefined,
    request: ApprovalRequest,
    blockReasonNow?: () => string | undefined,
  ): Promise<ToolCallEventResult | undefined> {
    if (signal?.aborted) return { block: true, reason: DENIED_REASON };
    const answer = await new Promise<{ confirmed: boolean; reason: string }>((resolve) => {
      const onAbort = () => settle(false);
      const settle = (confirmed: boolean, reason = DENIED_REASON) => {
        if (!this.pendingApprovals.delete(request.id)) return;
        signal?.removeEventListener("abort", onAbort);
        this.send(clusterId, agent.session.sessionId, {
          kind: "ui_resolved",
          payload: { id: request.id, confirmed },
        });
        resolve({ confirmed, reason });
      };
      this.pendingApprovals.set(request.id, {
        clusterId,
        request,
        settle,
        ...(blockReasonNow ? { blockReasonNow } : {}),
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.send(clusterId, agent.session.sessionId, { kind: "ui_request", payload: request });
    });
    return answer.confirmed ? undefined : { block: true, reason: answer.reason };
  }

  // Best effort: a cluster that is not connected, or an object that cannot be
  // loaded, leaves the card without a backup and still asks.
  private async approvalBackup(
    clusterId: string,
    target: ApprovalTarget,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    if (!hasApprovalBackup(target.tool) || this.options.getClusterStatus(clusterId) !== CONNECTED) return undefined;
    try {
      return await loadApprovalBackup({ api: this.options.getClusterApi(clusterId), signal }, target);
    } catch (error) {
      if (!signal?.aborted) {
        log.warn(`Loading the backup for the ${target.tool} approval failed: ${describeRequestError(error)}`);
      }
      return undefined;
    }
  }

  private thinkingLevel(): ThinkingLevel {
    return this.options.getThinkingLevel?.() ?? DEFAULT_THINKING_LEVEL;
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
          // pi hands each prompt a fresh copy of the sections and sends the
          // model only the ones that changed, so an edit applies from the next
          // message and an empty value removes its section. It fires for a run
          // started by a user message and by a custom message alike, and both
          // get the sections.
          pi.on("before_agent_start", (event) => {
            const { sections } = event.systemPromptOptions;
            const clusterName = this.options.getClusterName?.(clusterId)?.trim();
            const userRules = this.options.getUserRules?.()?.trim();
            if (clusterName) sections.cluster = clusterName;
            if (userRules) sections.user_rules = userRules;
            if (tools.some((tool) => tool.name === kubectlTool.name)) {
              sections.cli_policy = cliPolicySection(this.policyProfile(clusterId));
            }
          });
        },
      ],
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: sessionDir,
      agentDir,
      model,
      thinkingLevel: this.thinkingLevel(),
      modelRuntime,
      resourceLoader,
      noTools: "builtin",
      // One active chat per cluster: continue its latest session file, unless
      // New chat left its marker.
      sessionManager: existsSync(markerPath)
        ? SessionManager.create(sessionDir, sessionDir)
        : SessionManager.continueRecent(sessionDir, sessionDir),
      settingsManager: SettingsManager.inMemory({
        ...(this.options.retry === false ? { retry: { enabled: false } } : {}),
        ...(this.options.compaction ? { compaction: this.options.compaction } : {}),
      }),
    });

    this.useInjectedFetch(session);

    const agent: ClusterAgent = { session, autoApprove: false, passedKubectlCalls: new Map() };
    // Called from pi's listener loop and from a microtask, where a throw would
    // break the run or go uncaught in main, so a failure is only logged.
    const sendStats = () => {
      try {
        this.send(clusterId, agent.session.sessionId, { kind: "stats", payload: agent.session.getSessionStats() });
      } catch (error) {
        log.error(`Reading the session stats for cluster ${clusterId} failed:`, error);
      }
    };
    session.subscribe((event) => {
      // Repeats message_end and can carry large tool results.
      if (event.type === "entry_appended") return;
      // pi saves a message right after telling its listeners, hence the
      // microtask: by then the message is in the file and in the stats, which
      // pi computes from the saved entries.
      if (event.type === "message_end") {
        const isAnswer = event.message.role === "assistant";
        queueMicrotask(() => {
          // pi writes the file with the first saved message, so the marker is done.
          if (session.sessionFile && existsSync(session.sessionFile)) rmSync(markerPath, { force: true });
          if (isAnswer) sendStats();
        });
      }
      this.send(clusterId, agent.session.sessionId, { kind: "event", payload: toJsonEvent(event) });
      // Also after a run that saved no answer, and after a compaction shrank the context.
      if (event.type === "agent_settled" || event.type === "compaction_end") sendStats();
    });
    return agent;
  }

  // pi has no session-level fetch option, so the session's stream function is
  // wrapped to add the injected fetch to every model request. The chat, its
  // compaction and pi's cache warmer all send through this function.
  private useInjectedFetch(session: AgentSession): void {
    const streamFunction = session.agent.streamFunction;
    session.agent.streamFunction = (model, context, options) => {
      const fetch = APIS_WITHOUT_CUSTOM_FETCH.has(model.api) ? undefined : this.options.fetch;
      return streamFunction(model, context, fetch ? { ...options, fetch } : options);
    };
  }

  // Fire and forget: the session listener never waits on the frames, and a
  // failing broadcast must not break the run.
  private send(clusterId: string, sessionId: string, body: Pick<AgentEnvelope, "kind" | "payload">): void {
    const seq = (this.seqs.get(clusterId) ?? 0) + 1;
    this.seqs.set(clusterId, seq);
    try {
      this.options.broadcast({ clusterId, sessionId, seq, ...body } as AgentEnvelope);
    } catch (error) {
      log.error(`Broadcasting to the frames of cluster ${clusterId} failed:`, error);
    }
  }

  // Every tool runs here in main: kubectl through the CLI runner, the others on
  // the host's client of the chat's cluster.
  private toPiTool(clusterId: string, tool: AgentToolDefinition) {
    if (tool.name === kubectlTool.name) return this.toKubectlPiTool(clusterId, tool);
    const runner = Object.hasOwn(CLUSTER_TOOL_RUNNERS, tool.name) ? CLUSTER_TOOL_RUNNERS[tool.name] : undefined;
    return defineTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      executionMode: tool.mutating ? "sequential" : undefined,
      execute: async (_toolCallId, params, signal) => {
        if (!runner) throw new Error(`Unknown tool: ${tool.name}`);
        const text = await this.runClusterTool(clusterId, tool.name, runner, params as Record<string, unknown>, signal);
        return { content: [{ type: "text", text }], details: undefined };
      },
    });
  }

  private toKubectlPiTool(clusterId: string, tool: AgentToolDefinition) {
    return defineTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal, onUpdate) => {
        // No process starts for a cluster that is not connected.
        if (this.options.getClusterStatus(clusterId) !== CONNECTED) {
          throw new Error(CLUSTER_NOT_CONNECTED);
        }
        const agent = await this.clusters.get(clusterId);
        const passed = agent?.passedKubectlCalls.get(toolCallId);
        agent?.passedKubectlCalls.delete(toolCallId);
        if (!passed) throw new Error("The invocation policy has not checked this call.");
        const result = await runKubectl(params as KubectlToolInput, {
          ...passed,
          clusterId,
          runCli: this.options.runCli,
          signal,
          podLogsTailLines: this.options.getPodLogsTailLines(),
          onProgress: (message) => onUpdate?.({ content: [{ type: "text", text: message }], details: undefined }),
        });
        return { content: [{ type: "text", text: result.text }], details: result.details, isError: result.isError };
      },
    });
  }

  // Runs the call on the host's client of the chat's cluster. A throw becomes
  // an error result for the model; pi's signal aborts the request on Stop.
  private async runClusterTool(
    clusterId: string,
    toolName: string,
    runner: ClusterToolRunner,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    if (this.options.getClusterStatus(clusterId) !== CONNECTED) {
      throw new Error(CLUSTER_NOT_CONNECTED);
    }
    const context = {
      api: this.options.getClusterApi(clusterId),
      signal,
      podLogsTailLines: this.options.getPodLogsTailLines(),
    };
    try {
      return await runner(args, context);
    } catch (error) {
      throw new Error(`${toolName} failed: ${describeRequestError(error)}`);
    }
  }
}
