import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  vi.mocked(Main.Shell.getKubectlPath).mockReset();
  vi.mocked(Main.Shell.getEnvironment).mockReset();
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
    expect(agentEnvelopes().every((envelope) => envelope.kind === "event" || envelope.kind === "stats")).toBe(true);
  });

  describe("kubectl calls through the real CLI runner", () => {
    const fakeKubectl = join(import.meta.dirname, "../../test/fake-kubectl.mjs");
    let pidFile: string;

    beforeEach(() => {
      pidFile = join(dataDir, "fake-kubectl.pid");
      vi.mocked(Main.Catalog.getClusterById).mockImplementation((id) =>
        id === "c1"
          ? {
              id,
              name: "dev",
              kubeConfigPath: "/kube/config",
              contextName: "dev",
              status: Common.Clusters.ClusterConnectionStatus.CONNECTED,
              labels: {},
              isActive: true,
            }
          : undefined,
      );
      vi.mocked(Main.Shell.getKubectlPath).mockResolvedValue(fakeKubectl);
      // The fake kubectl runs with node from PATH, and with none of main's own variables.
      vi.mocked(Main.Shell.getEnvironment).mockResolvedValue({
        PATH: process.env.PATH ?? "",
        FAKE_KUBECTL_CLUSTER: "the environment of c1",
        FAKE_KUBECTL_PID_FILE: pidFile,
      });
      vi.stubEnv("FAKE_KUBECTL_LEAK", "main's own environment");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // The model calls kubectl with `input`; resolves with the tool's result once the run settled.
    const callKubectl = async (input: Parameters<typeof fauxToolCall>[1], whileRunning?: () => Promise<void>) => {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("kubectl", input)], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxText("done")]),
      ]);
      await load();
      await invokeAgent("c1", { type: "prompt", message: "run kubectl" });
      await whileRunning?.();
      await waitFor(() => settledRuns() === 1, 10_000);
      const [end] = agentEnvelopes().flatMap((envelope) =>
        envelope.kind === "event" && envelope.payload.type === "tool_execution_end" ? [envelope.payload] : [],
      );
      if (!end) throw new Error("kubectl was not called");
      const text = (end.result.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
      return { text, isError: end.isError };
    };

    const isRunning = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    it("runs the cluster's kubectl with the argument array as it is and the cluster's environment, without a shell", async () => {
      const args = ["get", "pods", "-l", "app=web; echo $HOME", "-o", "jsonpath={.items[*].metadata.name}"];

      const result = await callKubectl({ args });

      expect(Main.Shell.getKubectlPath).toHaveBeenCalledWith("c1", expect.anything());
      expect(Main.Shell.getEnvironment).toHaveBeenCalledWith("c1");
      expect(result.isError).toBe(false);
      const output = JSON.parse(result.text.split("Standard output:\n")[1] ?? "");
      expect(output).toEqual({ args, cluster: "the environment of c1", stdin: "" });
      expect(consoleError).not.toHaveBeenCalled();
    });

    // A diff runs without a card under Standard, the profile of every cluster.
    it("sends the manifest on standard input", async () => {
      const manifest = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n";

      const result = await callKubectl({ args: ["diff"], manifest });

      const output = JSON.parse(result.text.split("Standard output:\n")[1] ?? "");
      expect(output).toMatchObject({ args: ["diff", "-f", "-"], stdin: manifest });
    });

    it("turns a non-zero exit code into an error result with the standard error", async () => {
      const result = await callKubectl({ args: ["get", "pods", "fail"] });

      expect(result).toEqual({
        text: "Exit code: 3\n\nStandard output: (empty)\n\nStandard error:\nerror: failed on purpose",
        isError: true,
      });
    });

    it("caps the output", async () => {
      const result = await callKubectl({ args: ["get", "pods", "flood"] });

      expect(result.text).toMatch(
        /^Exit code: 0\n\nStandard output:\nhead\ny+\n\[\.\.\. 147467 of 409611 bytes cut \.\.\.\]\ny+\ntail$/,
      );
    });

    it("kills the process on Stop", async () => {
      const result = await callKubectl({ args: ["get", "pods", "hang"] }, async () => {
        await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8") !== "", 10_000);
        await invokeAgent("c1", { type: "abort" });
      });

      // Stop may come before the parent has read the line the fake kubectl wrote.
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/^kubectl was stopped before it ended\.\n\nStandard output:/);
      const pid = Number(readFileSync(pidFile, "utf8"));
      await waitFor(() => !isRunning(pid));
    });

    it("kills the process on the timeout", async () => {
      const result = await callKubectl({ args: ["get", "pods", "hang"], timeoutSeconds: 0.5 });

      expect(result).toEqual({
        text: "kubectl was killed after its timeout of 0.5 s.\n\nStandard output:\nwaiting",
        isError: true,
      });
      const pid = Number(readFileSync(pidFile, "utf8"));
      await waitFor(() => !isRunning(pid));
    });

    // Freelens downloads the cluster's kubectl for the first invocation, the gate's read of the resources.
    it("reports the phases and the progress of a kubectl download as partial tool updates", async () => {
      vi.mocked(Main.Shell.getKubectlPath).mockImplementationOnce(async (_clusterId, options) => {
        const download = options as Main.Shell.KubectlDownloadOptions;
        download.onPhase?.("Downloading kubectl 1.31.2");
        download.onDownloadProgress?.({ transferred: 0, total: 1000 });
        download.onDownloadProgress?.({ transferred: 1, total: 1000 });
        download.onDownloadProgress?.({ transferred: 500, total: 1000 });
        download.onDownloadProgress?.({ transferred: 3 * 1024 * 1024 });
        download.onProblem?.("Verifying the download failed, using the bundled kubectl");
        return fakeKubectl;
      });

      await callKubectl({ args: ["version"] });

      const updates = agentEnvelopes().flatMap((envelope) =>
        envelope.kind === "event" && envelope.payload.type === "tool_execution_update"
          ? (envelope.payload.partialResult.content ?? []).map((part) => (part.type === "text" ? part.text : ""))
          : [],
      );
      expect(updates).toEqual([
        "Downloading kubectl 1.31.2",
        "Downloading kubectl: 0%",
        "Downloading kubectl: 50%",
        "Downloading kubectl: 3.0 MB",
        "Verifying the download failed, using the bundled kubectl",
      ]);
    });
  });

  describe("the old per-tool approval choices", () => {
    it("become the default profile Standard (migrated), and the old fields are written back as null", async () => {
      const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
      preferencesStore.legacy = { toolApprovalOverrides: { deletePod: false }, podLogsRequireApproval: true };

      await load();

      expect(preferencesStore.userProfiles).toEqual([
        expect.objectContaining({
          id: "standard-migrated",
          name: "Standard (migrated)",
          rules: expect.arrayContaining([{ pattern: "kubectl delete pods *", level: "allow" }]),
        }),
      ]);
      expect(preferencesStore.defaultProfileId).toBe("standard-migrated");
      expect(preferencesStore.toJSON()).toMatchObject({ toolApprovalOverrides: null, podLogsRequireApproval: null });
    });

    it("leave a user who never changed them on Standard, without a new profile", async () => {
      const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
      preferencesStore.legacy = { toolApprovalOverrides: {} };

      await load();

      expect(preferencesStore.userProfiles).toEqual([]);
      expect(preferencesStore.defaultProfileId).toBe("standard");
      expect(preferencesStore.toJSON()).toMatchObject({ toolApprovalOverrides: null });
    });

    it("are moved once, even when an old field comes back", async () => {
      const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
      preferencesStore.legacy = { toolApprovalOverrides: { deletePod: false } };
      const first = await load();
      await first.disable();
      preferencesStore.defaultProfileId = "standard";
      preferencesStore.legacy = { toolApprovalOverrides: { deletePod: false } };

      await load();

      expect(preferencesStore.userProfiles.map((profile) => profile.id)).toEqual(["standard-migrated"]);
      expect(preferencesStore.defaultProfileId).toBe("standard");
    });
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
