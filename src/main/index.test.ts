import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Common, Main } from "@freelensapp/extensions";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { ipcMainHandlers } from "../../test/freelens-extensions";
import { createFakeKubeJsonApi } from "../../test/kube-json-api";
import {
  AGENT_COMMAND_CHANNEL,
  AGENT_ENVELOPE_CHANNEL,
  type AgentCommand,
  type AgentEnvelope,
} from "../common/agent-protocol";
import { PROVIDER_COMMAND_CHANNEL } from "../common/provider-protocol";
import { PreferencesStore } from "../common/store";
import LensExtensionAiMain from "./index";

// Before any module creates its logger: loglevel binds the console methods
// when a logger's level is set, so a spy installed later would see nothing.
const consoleError = vi.hoisted(() => vi.spyOn(console, "error"));

const createModelRuntime = ModelRuntime.create.bind(ModelRuntime);

let dataDir: string;
let faux: ReturnType<typeof fauxProvider>;
let loaded: LensExtensionAiMain[];
let broadcast: MockInstance<Main.Ipc["broadcast"]>;

// The host's order: a new instance is activated, then enabled; `disable()`
// awaits `onDeactivate` and then removes what the extension registered.
const load = async () => {
  // The stubbed base class reads nothing of the installed extension.
  const installed = {} as ConstructorParameters<typeof LensExtensionAiMain>[0];
  const extension = new LensExtensionAiMain(installed);
  loaded.push(extension);
  await extension.activate();
  await extension.enable();
  return extension;
};

const invokeAgent = (clusterId: string, command: AgentCommand) => {
  const handler = ipcMainHandlers.get(AGENT_COMMAND_CHANNEL);
  if (!handler) throw new Error(`no handler for ${AGENT_COMMAND_CHANNEL}`);
  return handler({}, clusterId, command);
};

const agentEnvelopes = (): AgentEnvelope[] =>
  broadcast.mock.calls.flatMap(([channel, envelope]) =>
    channel === AGENT_ENVELOPE_CHANNEL ? [envelope as AgentEnvelope] : [],
  );

const settledRuns = () =>
  agentEnvelopes().filter((envelope) => envelope.kind === "event" && envelope.payload.type === "agent_settled").length;

// The signal of the last model request that `waitForAbort` answers.
let requestSignal: AbortSignal | undefined;

// Answers only once the request is aborted, so the run is in progress until then.
const waitForAbort: FauxResponseFactory = (_context, options) =>
  new Promise((resolve) => {
    requestSignal = options?.signal;
    requestSignal?.addEventListener(
      "abort",
      () => resolve(fauxAssistantMessage([], { stopReason: "aborted", errorMessage: "Request was aborted" })),
      { once: true },
    );
  });

const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "extension-main-"));
  vi.spyOn(Main.LensExtension.prototype, "getExtensionFileFolder").mockResolvedValue(dataDir);
  faux = fauxProvider({ tokensPerSecond: 100_000 });
  vi.spyOn(ModelRuntime, "create").mockImplementation(async (options) => {
    const modelRuntime = await createModelRuntime(options);
    modelRuntime.registerNativeProvider(faux.provider);
    return modelRuntime;
  });
  broadcast = vi.spyOn(Main.Ipc.prototype, "broadcast");
  consoleError.mockClear();
  loaded = [];
  requestSignal = undefined;

  PreferencesStore.resetInstance();
  const model = faux.getModel();
  PreferencesStore.getInstanceOrCreate<PreferencesStore>().agentModel = `${model.provider}/${model.id}`;
});

afterEach(async () => {
  for (const extension of loaded) {
    await extension.disable();
  }
  vi.mocked(Main.LensExtension.prototype.getExtensionFileFolder).mockRestore();
  vi.mocked(ModelRuntime.create).mockRestore();
  vi.mocked(Main.Catalog.getClusterById).mockReset();
  vi.mocked(Main.K8sApi.KubeJsonApi.forCluster).mockReset();
  broadcast.mockRestore();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("LensExtensionAiMain", () => {
  it("handles the agent and provider commands over IPC once activated", async () => {
    faux.setResponses([fauxAssistantMessage([fauxText("Hello from the cluster assistant.")])]);

    await load();

    expect([...ipcMainHandlers.keys()].sort()).toEqual([AGENT_COMMAND_CHANNEL, PROVIDER_COMMAND_CHANNEL].sort());
    await expect(invokeAgent("c1", { type: "prompt", message: "hi" })).resolves.toMatchObject({ success: true });
    await waitFor(() => settledRuns() === 1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("runs a read on the host's client of the chat's cluster once the catalog has it connected", async () => {
    const cluster = createFakeKubeJsonApi({ "/version": { major: "1", minor: "31", gitVersion: "v1.31.2" } });
    vi.mocked(Main.Catalog.getClusterById).mockImplementation((id) =>
      id === "c1"
        ? {
            id,
            name: "prod",
            kubeConfigPath: "/kube/config",
            contextName: "prod",
            status: Common.Clusters.ClusterConnectionStatus.CONNECTED,
            labels: {},
            isActive: true,
          }
        : undefined,
    );
    vi.mocked(Main.K8sApi.KubeJsonApi.forCluster).mockReturnValue(cluster.api);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("getClusterVersion", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("v1.31.2")]),
    ]);

    await load();
    await invokeAgent("c1", { type: "prompt", message: "which version?" });
    await waitFor(() => settledRuns() === 1);

    expect(Main.K8sApi.KubeJsonApi.forCluster).toHaveBeenCalledWith("c1");
    expect(cluster.requests).toEqual([expect.objectContaining({ method: "get", path: "/version" })]);
    expect(agentEnvelopes().some((envelope) => envelope.kind === "tool_request")).toBe(false);
  });

  it("sends the chat's model requests with the host's fetch", async () => {
    const hostFetch = vi.mocked(Main.Util.fetch);
    hostFetch.mockClear();
    faux.setResponses([
      async (_context, options) => {
        await options?.fetch?.("https://models.example/v1/chat", { method: "POST" });
        return fauxAssistantMessage([fauxText("Answered through the host.")]);
      },
    ]);

    await load();
    await invokeAgent("c1", { type: "prompt", message: "hi" });
    await waitFor(() => settledRuns() === 1);

    expect(hostFetch).toHaveBeenCalledWith("https://models.example/v1/chat", { method: "POST" });
  });

  it("leaves one handler per IPC channel and one agent host after deactivating and activating again", async () => {
    faux.setResponses([waitForAbort, fauxAssistantMessage([fauxText("Answered after the reload.")])]);
    const first = await load();
    await invokeAgent("c1", { type: "prompt", message: "before the reload" });
    await waitFor(() => requestSignal !== undefined);
    await first.disable();
    broadcast.mockClear();

    await load();

    expect([...ipcMainHandlers.keys()].sort()).toEqual([AGENT_COMMAND_CHANNEL, PROVIDER_COMMAND_CHANNEL].sort());
    await invokeAgent("c1", { type: "prompt", message: "after the reload" });
    await waitFor(() => settledRuns() === 1);
    // The first agent host stopped its run; only the new one talks to the frames.
    expect(requestSignal?.aborted).toBe(true);
    const envelopes = agentEnvelopes();
    expect(new Set(envelopes.map((envelope) => envelope.sessionId)).size).toBe(1);
    expect(envelopes.map((envelope) => envelope.seq)).toEqual(envelopes.map((_, index) => index + 1));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("stops a run in progress when deactivated, without an error", async () => {
    faux.setResponses([waitForAbort]);
    const extension = await load();
    await invokeAgent("c1", { type: "prompt", message: "hi" });
    await waitFor(() => requestSignal !== undefined);

    await extension.disable();

    expect(requestSignal?.aborted).toBe(true);
    const envelopesAtDeactivation = agentEnvelopes().length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(agentEnvelopes()).toHaveLength(envelopesAtDeactivation);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
