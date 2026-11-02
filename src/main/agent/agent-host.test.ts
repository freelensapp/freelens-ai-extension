import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FauxResponseFactory as FauxFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeKubeJsonApi } from "../../../test/kube-json-api";
import {
  API_RESOURCES_KEY,
  apiResourcesTable,
  createStandInCli,
  KUBECONFIG_NAMESPACE_KEY,
  STAND_IN_RESOURCES,
} from "../../../test/stand-in-cli";
import { isCliApprovalRequest } from "../../common/agent-protocol";
import {
  createKubernetesResourceTool,
  deleteKubernetesResourceTool,
  deletePodTool,
  getClusterVersionTool,
  getPodLogsTool,
  kubectlTool,
  patchKubernetesResourceTool,
  restartKubernetesResourceTool,
  updateKubernetesResourceTool,
} from "../../common/agent-tools";
import { loadApprovalOverrides } from "../../common/agent-tools/approval-settings";
import { READ_ONLY_PROFILE, STANDARD_PROFILE } from "../../common/invocation-policy/shipped-profiles";
import { AgentHost, type AgentHostOptions } from "./agent-host";
import { API_RESOURCES_ARGS, KUBECONFIG_NAMESPACE_ARGS } from "./tools/cluster-resources";

import type { AgentEnvelope, AgentSnapshot } from "../../common/agent-protocol";
import type { AgentToolDefinition } from "../../common/agent-tools";
import type { PolicyProfile } from "../../common/invocation-policy/policy-profile";
import type { CliResult } from "./cli-runner";

type Faux = ReturnType<typeof fauxProvider>;

const WEB_1 = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: { name: "web-1", namespace: "default" },
  spec: { containers: [{ name: "app" }] },
};

const WEB = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "default" },
  spec: { replicas: 2 },
  status: { readyReplicas: 2 },
};

// A profile under which every kubectl call runs without a card.
const ALLOW_ALL_PROFILE: PolicyProfile = { id: "allow-all", name: "Allow all", rules: [], fallbackLevel: "allow" };

// What main may broadcast: nothing asks the frame to run a tool.
const ENVELOPE_KINDS = ["event", "stats", "ui_request", "ui_resolved", "auto_approve"];

describe("AgentHost", () => {
  let dataDir: string;
  let modelRuntime: ModelRuntime;
  let faux: Faux;
  let envelopes: AgentEnvelope[];
  let host: AgentHost | undefined;
  // The cluster of every chat: "c1" and "c2" are connected, "gone" is not.
  let cluster: ReturnType<typeof createFakeKubeJsonApi>;
  // The CLI runner of every chat; a test that needs answers replaces it before creating the host.
  let cli: ReturnType<typeof createStandInCli>;
  const clusterStatus: Record<string, string> = { c1: "connected", c2: "connected", gone: "disconnected" };

  const standInCluster = (options: Parameters<typeof createFakeKubeJsonApi>[1] = {}) =>
    createFakeKubeJsonApi(
      {
        "/version": { major: "1", minor: "31", gitVersion: "v1.31.2" },
        "/api/v1/namespaces/default/pods/web-1": WEB_1,
        "/apis/apps/v1/namespaces/default/deployments/web": WEB,
        "/apis/apps/v1/namespaces/default/deployments/api": { ...WEB, metadata: { name: "api", namespace: "default" } },
      },
      {
        responses: { "/api/v1/namespaces/default/pods/web-1/log": { status: 200, text: "started\n" } },
        ...options,
      },
    );

  beforeEach(async () => {
    cluster = standInCluster();
    cli = createStandInCli();
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
      getClusterStatus: (clusterId) => clusterStatus[clusterId],
      getClusterApi: () => cluster.api,
      runCli: cli.run,
      getPolicyProfile: () => STANDARD_PROFILE,
      getPodLogsTailLines: () => 500,
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
    expect(envelopes.every((e) => e.clusterId === "c1" && (e.kind === "event" || e.kind === "stats"))).toBe(true);
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

  // The model calls `toolName` once, then answers with the text of the tool result it got.
  const callThenEcho = (toolName: string, args: Parameters<typeof fauxToolCall>[1]) => [
    fauxAssistantMessage([fauxToolCall(toolName, args)], { stopReason: "toolUse" }),
    (context: { messages: Array<{ role: string; content?: unknown }> }) => {
      const last = context.messages[context.messages.length - 1];
      const parts = last?.role === "toolResult" ? (last.content as Array<{ type: string; text?: string }>) : [];
      return fauxAssistantMessage([fauxText(`Result: ${parts.map((part) => part.text ?? "").join("")}`)]);
    },
  ];
  const answerText = () =>
    envelopes
      .flatMap((e) => (e.kind === "event" && e.payload.type === "message_update" ? [e.payload] : []))
      .map((p) => (p.assistantMessageEvent.type === "text_delta" ? p.assistantMessageEvent.delta : ""))
      .join("");
  const toolEnd = () =>
    envelopes.flatMap((e) => (e.kind === "event" && e.payload.type === "tool_execution_end" ? [e.payload] : []));

  describe("read tools", () => {
    it("runs a read in main on the chat's cluster: its result reaches the model and the frame gets no request", async () => {
      faux.setResponses(callThenEcho("getClusterVersion", {}));
      const clients: string[] = [];
      const host = createHost({
        getClusterApi: (clusterId) => {
          clients.push(clusterId);
          return cluster.api;
        },
      });

      await host.handleCommand("c1", { type: "prompt", message: "which version?" });
      await waitFor(settled);

      expect(answerText()).toBe('Result: {"version":"v1.31.2","major":"1","minor":"31"}');
      expect(clients).toEqual(["c1"]);
      expect(cluster.requests).toEqual([expect.objectContaining({ method: "get", path: "/version" })]);
      expect(envelopes.every((e) => ENVELOPE_KINDS.includes(e.kind))).toBe(true);
    });

    it.each([
      ["a cluster Freelens does not know", "nowhere"],
      ["a disconnected cluster", "gone"],
    ])("answers a read on %s with 'Cluster not connected' and sends no request", async (_case, clusterId) => {
      faux.setResponses(callThenEcho("getClusterVersion", {}));
      let clients = 0;
      const host = createHost({
        getClusterApi: () => {
          clients += 1;
          return cluster.api;
        },
      });

      await host.handleCommand(clusterId, { type: "prompt", message: "which version?" });
      await waitFor(settled);

      expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "getClusterVersion", isError: true })]);
      expect(answerText()).toBe("Result: Cluster not connected");
      expect(clients).toBe(0);
      expect(cluster.requests).toEqual([]);
    });

    it("describes a failed request for the model as an error result", async () => {
      faux.setResponses(callThenEcho("getPodLogs", { name: "gone", namespace: "default" }));
      const host = createHost({ tools: [getPodLogsTool], getApprovalOverrides: () => ({ getPodLogs: false }) });

      await host.handleCommand("c1", { type: "prompt", message: "show the logs" });
      await waitFor(settled);

      expect(toolEnd()).toEqual([expect.objectContaining({ isError: true })]);
      expect(answerText()).toBe("Result: getPodLogs failed: /api/v1/namespaces/default/pods/gone not found");
    });

    it("aborts the request in progress on Stop", async () => {
      cluster = standInCluster({ hang: ["/version"] });
      faux.setResponses(callThenEcho("getClusterVersion", {}));
      const host = createHost();

      await host.handleCommand("c1", { type: "prompt", message: "which version?" });
      await waitFor(() => cluster.requests.length > 0);
      const [request] = cluster.requests;
      expect(request?.signal?.aborted).toBe(false);

      expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });

      await waitFor(settled);
      expect(request?.signal?.aborted).toBe(true);
      expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "getClusterVersion", isError: true })]);
      expect((await snapshotOf(host)).isStreaming).toBe(false);
    });
  });

  describe("kubectl tool", () => {
    // Most tests run under a profile that allows everything, so no card comes up.
    const withoutApproval: Partial<AgentHostOptions> = {
      tools: [kubectlTool],
      getPolicyProfile: () => ALLOW_ALL_PROFILE,
    };
    // The text of the first tool result, as the model got it.
    const toolResultText = () =>
      (toolEnd()[0]?.result.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");

    it("runs the invocation on the chat's cluster and answers the model with the exit code and the output", async () => {
      cli = createStandInCli({
        answers: { "get pods -n flux-system": { stdout: "NAME                READY\nsource-controller   1/1\n" } },
      });
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "pods", "-n", "flux-system"] }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "list the pods in flux-system" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([
        {
          clusterId: "c1",
          program: "kubectl",
          args: ["get", "pods", "-n", "flux-system"],
          timeoutMs: 30_000,
          signal: expect.any(AbortSignal),
        },
      ]);
      expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "kubectl", isError: false })]);
      expect(answerText()).toBe(
        "Result: Exit code: 0\n\nStandard output:\nNAME                READY\nsource-controller   1/1",
      );
    });

    it("makes a non-zero exit code an error result with the standard error", async () => {
      cli = createStandInCli({
        answers: { "get pod gone": { stderr: 'Error from server (NotFound): pods "gone" not found\n', exitCode: 1 } },
      });
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "pod", "gone"] }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "show the pod gone" });
      await waitFor(settled);

      expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "kubectl", isError: true })]);
      expect(answerText()).toBe(
        'Result: Exit code: 1\n\nStandard output: (empty)\n\nStandard error:\nError from server (NotFound): pods "gone" not found',
      );
    });

    it("keeps the standard error of a call that succeeded", async () => {
      cli = createStandInCli({
        answers: { "get pods": { stdout: "web-1\n", stderr: "Warning: v1 ComponentStatus is deprecated\n" } },
      });
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "pods"] }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "list the pods" });
      await waitFor(settled);

      expect(toolEnd()).toEqual([expect.objectContaining({ isError: false })]);
      expect(answerText()).toBe(
        "Result: Exit code: 0\n\nStandard output:\nweb-1\n\nStandard error:\nWarning: v1 ComponentStatus is deprecated",
      );
    });

    it("keeps only the lines of the standard output that match grep", async () => {
      cli = createStandInCli({
        answers: {
          "get events -A": {
            stdout: "NAMESPACE TYPE REASON\nweb Normal Pulled\nweb Warning BackOff\nflux-system Warning Failed\n",
          },
        },
      });
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "events", "-A"], grep: "Warning" }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "any warnings?" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([expect.objectContaining({ args: ["get", "events", "-A"] })]);
      expect(answerText()).toBe(
        "Result: Exit code: 0\n\nStandard output:\nweb Warning BackOff\nflux-system Warning Failed",
      );
    });

    it("caps the output at 256 KiB, keeping its head and tail with a marker of how much was cut", async () => {
      // 11 + 409,600 + 11 bytes: 147,478 more than 262,144.
      const stdout = `first line\n${"x".repeat(400 * 1024)}\nlast line\n`;
      cli = createStandInCli({ answers: { "get pods -A -o yaml": { stdout } } });
      // Streaming the result back through the faux model would be slow, so the
      // test reads the tool result itself.
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("kubectl", { args: ["get", "pods", "-A", "-o", "yaml"] })], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage([fauxText("done")]),
      ]);
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "everything" });
      await waitFor(settled);

      const text = toolResultText();
      expect(text.startsWith("Exit code: 0\n\nStandard output:\nfirst line\nxxx")).toBe(true);
      expect(text.endsWith("xxx\nlast line")).toBe(true);
      expect(text).toContain("x\n[... 147478 of 409622 bytes cut ...]\nx");
      // 131,072 bytes of the head and of the tail, each with 11 bytes of a line around the x.
      expect([...text.matchAll(/x{2,}/g)].map((match) => match[0].length)).toEqual([131_061, 131_061]);
    });

    it("sends the manifest on standard input with -f - added", async () => {
      const manifest = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n  namespace: web\n";
      cli = createStandInCli({ answers: { "apply -f -": { stdout: "configmap/settings created\n" } } });
      faux.setResponses(callThenEcho("kubectl", { args: ["apply"], manifest }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "create the config map" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([expect.objectContaining({ args: ["apply", "-f", "-"], manifest })]);
      expect(answerText()).toBe("Result: Exit code: 0\n\nStandard output:\nconfigmap/settings created");
    });

    it("leaves the arguments after -- to the command they belong to", async () => {
      const args = ["exec", "web-1", "--", "tail", "-n", "5", "-f", "/var/log/app.log"];
      cli = createStandInCli({ answers: { [args.join(" ")]: { stdout: "line\n" } } });
      faux.setResponses(callThenEcho("kubectl", { args }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "tail the log" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([expect.objectContaining({ args })]);
    });

    it("sends the manifest of a call with flags before the verb, with -f - added at the end", async () => {
      const manifest = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n";
      cli = createStandInCli({ answers: { "-n web apply -f -": { stdout: "configmap/settings created\n" } } });
      faux.setResponses(callThenEcho("kubectl", { args: ["-n", "web", "apply"], manifest }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "create the config map" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([expect.objectContaining({ args: ["-n", "web", "apply", "-f", "-"], manifest })]);
    });

    it("rejects an invalid grep before asking, and starts no process", async () => {
      faux.setResponses(callThenEcho("kubectl", { args: ["scale", "deployment/web", "--replicas=3"], grep: "web-(" }));
      const host = createHost({ tools: [kubectlTool] });

      await host.handleCommand("c1", { type: "prompt", message: "go" });
      await waitFor(settled);

      expect(envelopes.some((e) => e.kind === "ui_request")).toBe(false);
      expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "kubectl", isError: true })]);
      expect(toolResultText()).toMatch(/^grep is not a valid regular expression/);
      expect(cli.invocations).toEqual([]);
    });

    it.each<[string, number | undefined, number]>([
      ["30 seconds when the call sets none", undefined, 30_000],
      ["the call's own", 5, 5_000],
      ["at most 300 seconds", 900, 300_000],
    ])("runs with a timeout of %s", async (_case, timeoutSeconds, timeoutMs) => {
      cli = createStandInCli({ answers: { version: { stdout: "v1.31.2\n" } } });
      faux.setResponses(callThenEcho("kubectl", { args: ["version"], ...(timeoutSeconds ? { timeoutSeconds } : {}) }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "which version?" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([expect.objectContaining({ timeoutMs })]);
    });

    it("says that the timeout killed kubectl, with the output it wrote until then", async () => {
      cli = createStandInCli({
        answers: {
          "rollout status deployment/web": { stdout: "Waiting for rollout\n", exitCode: null, killed: "timeout" },
        },
      });
      faux.setResponses(callThenEcho("kubectl", { args: ["rollout", "status", "deployment/web"], timeoutSeconds: 10 }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "wait for web" });
      await waitFor(settled);

      expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "kubectl", isError: true })]);
      expect(answerText()).toBe(
        "Result: kubectl was killed after its timeout of 10 s.\n\nStandard output:\nWaiting for rollout",
      );
    });

    it("kills the invocation in progress on Stop and says that Stop ended it", async () => {
      cli = createStandInCli({ hang: ["rollout status deployment/web"] });
      faux.setResponses(callThenEcho("kubectl", { args: ["rollout", "status", "deployment/web"] }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "wait for web" });
      await waitFor(() => cli.actions().length > 0);
      expect(cli.actions()[0]?.signal?.aborted).toBe(false);

      expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });
      await waitFor(settled);

      expect(cli.actions()[0]?.signal?.aborted).toBe(true);
      expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "kubectl", isError: true })]);
      expect(toolResultText()).toBe("kubectl was stopped before it ended.\n\nStandard output: (empty)");
      expect((await snapshotOf(host)).isStreaming).toBe(false);
    });

    it.each<[string[], string[]]>([
      [
        ["logs", "deployment/web", "-c", "app"],
        ["logs", "deployment/web", "-c", "app", "--tail=200"],
      ],
      [
        ["logs", "web-1", "--tail", "20"],
        ["logs", "web-1", "--tail", "20"],
      ],
      [
        ["logs", "web-1", "--tail=20"],
        ["logs", "web-1", "--tail=20"],
      ],
      [
        ["logs", "web-1", "--since", "1h"],
        ["logs", "web-1", "--since", "1h"],
      ],
      [
        ["logs", "web-1", "--since=1h"],
        ["logs", "web-1", "--since=1h"],
      ],
      [
        ["logs", "web-1", "--since-time=2026-01-01T00:00:00Z"],
        ["logs", "web-1", "--since-time=2026-01-01T00:00:00Z"],
      ],
      [
        ["get", "pods"],
        ["get", "pods"],
      ],
    ])("reads %j with the pod logs tail lines preference unless it sets a tail or a time window", async (args, ran) => {
      faux.setResponses(callThenEcho("kubectl", { args }));
      const host = createHost({ ...withoutApproval, getPodLogsTailLines: () => 200 });

      await host.handleCommand("c1", { type: "prompt", message: "show the logs" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([expect.objectContaining({ args: ran })]);
    });

    it("forwards the progress of a kubectl download as partial tool updates", async () => {
      cli = createStandInCli({
        answers: { version: { stdout: "v1.31.2\n" } },
        progress: ["Downloading kubectl 1.31.2", "Downloading kubectl 1.31.2: 50%"],
      });
      faux.setResponses(callThenEcho("kubectl", { args: ["version"] }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "which version?" });
      await waitFor(settled);

      const updates = envelopes.flatMap((e) =>
        e.kind === "event" && e.payload.type === "tool_execution_update" ? [e.payload] : [],
      );
      expect(updates.map((update) => ({ toolName: update.toolName, content: update.partialResult.content }))).toEqual([
        { toolName: "kubectl", content: [{ type: "text", text: "Downloading kubectl 1.31.2" }] },
        { toolName: "kubectl", content: [{ type: "text", text: "Downloading kubectl 1.31.2: 50%" }] },
      ]);
    });

    it("gives the chat the arguments that ran and the exit code with the result, also in the snapshot", async () => {
      cli = createStandInCli({ answers: { "apply -f -": { stderr: "error: invalid object\n", exitCode: 1 } } });
      const manifest = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n";
      faux.setResponses(callThenEcho("kubectl", { args: ["apply"], manifest }));
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "apply it" });
      await waitFor(settled);

      const details = { args: ["apply", "-f", "-"], exitCode: 1 };
      expect(toolEnd()).toEqual([expect.objectContaining({ result: expect.objectContaining({ details }) })]);
      expect((await snapshotOf(host)).messages).toContainEqual(
        expect.objectContaining({ role: "toolResult", toolName: "kubectl", isError: true, details }),
      );
    });

    it("runs the calls of one answer one at a time", async () => {
      cli = createStandInCli({ answers: { "get pods": { stdout: "web-1\n" } }, hang: ["get nodes"] });
      faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("kubectl", { args: ["get", "nodes"] }), fauxToolCall("kubectl", { args: ["get", "pods"] })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage([fauxText("done")]),
      ]);
      const host = createHost(withoutApproval);

      await host.handleCommand("c1", { type: "prompt", message: "nodes and pods" });
      await waitFor(() => cli.actions().length > 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(cli.actions().map((invocation) => invocation.args)).toEqual([["get", "nodes"]]);

      await host.handleCommand("c1", { type: "abort" });
      await waitFor(settled);
    });

    it.each([
      ["a cluster Freelens does not know", "nowhere"],
      ["a disconnected cluster", "gone"],
    ])("answers a call on %s with 'Cluster not connected' and starts no process", async (_case, clusterId) => {
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "pods"] }));
      const host = createHost(withoutApproval);

      await host.handleCommand(clusterId, { type: "prompt", message: "list the pods" });
      await waitFor(settled);

      expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "kubectl", isError: true })]);
      expect(answerText()).toBe("Result: Cluster not connected");
      expect(cli.invocations).toEqual([]);
    });
  });

  describe("the invocation policy of kubectl calls", () => {
    const uiRequests = () => envelopes.flatMap((e) => (e.kind === "ui_request" ? [e.payload] : []));
    const uiResolved = () => envelopes.flatMap((e) => (e.kind === "ui_resolved" ? [e.payload] : []));
    const autoApproveChanges = () => envelopes.flatMap((e) => (e.kind === "auto_approve" ? [e.payload] : []));
    const toolResultTexts = () =>
      toolEnd().map((end) =>
        (end.result.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join(""),
      );
    const kubectlHost = (overrides: Partial<AgentHostOptions> = {}) =>
      createHost({ tools: [kubectlTool], ...overrides });
    const scaleWeb = ["scale", "deployment", "web", "--replicas=3"];
    const scaleApi = ["scale", "deployment", "api", "--replicas=3"];
    const execWeb = ["exec", "web-1", "--", "cat", "/etc/app.conf"];
    // A model answer that waits until the test lets it go, so the test can act between two tool calls.
    const heldUntil = (gate: Promise<void>, message: ReturnType<typeof fauxAssistantMessage>) => async () => {
      await gate;
      return message;
    };
    const kubectlCalls = (...calls: string[][]) => [
      ...calls.map((args) => fauxAssistantMessage([fauxToolCall("kubectl", { args })], { stopReason: "toolUse" })),
      fauxAssistantMessage([fauxText("done")]),
    ];
    const answer = (host: AgentHost, confirmed: boolean, approveAll = false) =>
      host.handleCommand("c1", {
        type: "ui_response",
        id: uiRequests()[uiRequests().length - 1]!.id,
        confirmed,
        ...(approveAll ? { approveAll } : {}),
      });

    it.each<[string, string[], string | RegExp]>([
      [
        "a flag that changes the cluster",
        ["get", "pods", "--context", "prod"],
        "Blocked by the floor, which no policy profile lifts. Flags that change the cluster or the identity: " +
          "--context is never allowed. An invocation stays on the chat's cluster, with the connection and the user " +
          "Freelens has for it.",
      ],
      [
        "a file of the user's disk",
        ["apply", "-f", "deploy.yaml"],
        /^Blocked by the floor.* The user's disk and local code: /,
      ],
      [
        "logs that follow",
        ["logs", "-f", "web-1"],
        /^Blocked by the floor.* Invocations that never end or need a terminal: /,
      ],
      [
        "a verb that is not kubectl's",
        ["frobnicate", "pods"],
        /^Blocked by the floor.* The user's disk and local code: /,
      ],
    ])("blocks %s by the floor with its reason, and the call never runs", async (_case, args, reason) => {
      faux.setResponses(callThenEcho("kubectl", { args }));
      const host = kubectlHost({ getPolicyProfile: () => ALLOW_ALL_PROFILE });

      await host.handleCommand("c1", { type: "prompt", message: "go" });
      await waitFor(settled);

      expect(uiRequests()).toEqual([]);
      expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "kubectl", isError: true })]);
      expect(toolResultTexts()[0]).toMatch(reason);
      expect(cli.actions()).toEqual([]);
    });

    it("blocks a manifest with a verb that takes none by the floor", async () => {
      const manifest = "apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\n";
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "pods"], manifest }));
      const host = kubectlHost({ getPolicyProfile: () => ALLOW_ALL_PROFILE });

      await host.handleCommand("c1", { type: "prompt", message: "go" });
      await waitFor(settled);

      expect(toolResultTexts()[0]).toMatch(/^Blocked by the floor.* Manifests that do not parse or do not belong: /);
      expect(cli.actions()).toEqual([]);
    });

    it("blocks a call the profile denies with the profile and the level, and the call never runs", async () => {
      faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
      const host = kubectlHost({ getPolicyProfile: () => READ_ONLY_PROFILE });

      await host.handleCommand("c1", { type: "prompt", message: "scale web" });
      await waitFor(settled);

      expect(uiRequests()).toEqual([]);
      expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "kubectl", isError: true })]);
      expect(toolResultTexts()).toEqual([
        'Denied by the policy profile "Read only": kubectl scale deployments web -n default gets Deny from the ' +
          "profile's fallback level.",
      ]);
      expect(cli.actions()).toEqual([]);
    });

    it("names the rule that denied a call", async () => {
      const profile: PolicyProfile = {
        id: "no-deletes",
        name: "No deletes",
        rules: [{ pattern: "kubectl delete pods *", level: "deny" }],
        fallbackLevel: "allow",
      };
      faux.setResponses(callThenEcho("kubectl", { args: ["delete", "pod", "web-1", "web-2", "-n", "web"] }));
      const host = kubectlHost({ getPolicyProfile: () => profile });

      await host.handleCommand("c1", { type: "prompt", message: "delete them" });
      await waitFor(settled);

      expect(toolResultTexts()).toEqual([
        'Denied by the policy profile "No deletes": kubectl delete pods web-1 -n web gets Deny from the rule ' +
          '"kubectl delete pods *"; kubectl delete pods web-2 -n web gets Deny from the rule "kubectl delete pods *".',
      ]);
      expect(cli.actions()).toEqual([]);
    });

    it("runs a call the profile allows without a card", async () => {
      cli = createStandInCli({ answers: { "get pods -n flux-system": { stdout: "source-controller\n" } } });
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "pods", "-n", "flux-system"] }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "list the pods in flux-system" });
      await waitFor(settled);

      expect(uiRequests()).toEqual([]);
      expect(cli.actions()).toEqual([expect.objectContaining({ args: ["get", "pods", "-n", "flux-system"] })]);
      expect(answerText()).toBe("Result: Exit code: 0\n\nStandard output:\nsource-controller");
    });

    it("asks before an Ask call with its command line, targets, level and profile, and runs it once approved", async () => {
      cli = createStandInCli({ answers: { [scaleWeb.join(" ")]: { stdout: "deployment.apps/web scaled\n" } } });
      faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "scale web" });
      await waitFor(() => uiRequests().length > 0);

      const request = uiRequests()[0]!;
      expect(request).toEqual({
        id: expect.any(String),
        toolCallId: expect.any(String),
        method: "confirm",
        program: "kubectl",
        args: scaleWeb,
        canonicalForms: [
          { program: "kubectl", verb: "scale", resource: "deployments", name: "web", namespace: "default" },
        ],
        level: "ask",
        profileName: "Standard",
        // The stand-in CLI has no answer for the dry run here; "the dry-run preview" covers it.
        preview: expect.objectContaining({ kind: "unavailable" }),
      });
      expect(cli.actions()).toEqual([]);
      expect((await snapshotOf(host)).pendingUiRequest).toEqual(request);

      await answer(host, true);
      await waitFor(settled);

      expect(uiResolved()).toEqual([{ id: request.id, confirmed: true }]);
      expect(cli.actions()).toEqual([expect.objectContaining({ args: scaleWeb })]);
      expect(answerText()).toBe("Result: Exit code: 0\n\nStandard output:\ndeployment.apps/web scaled");
      expect((await snapshotOf(host)).pendingUiRequest).toBeUndefined();
    });

    it("puts the manifest and a target per object on the card", async () => {
      const manifest =
        "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n  namespace: web\n---\n" +
        "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: web\n";
      faux.setResponses(callThenEcho("kubectl", { args: ["apply"], manifest }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "apply it" });
      await waitFor(() => uiRequests().length > 0);

      expect(uiRequests()[0]).toMatchObject({
        args: ["apply"],
        manifest,
        canonicalForms: [
          { program: "kubectl", verb: "apply", resource: "configmaps", name: "settings", namespace: "web" },
          { program: "kubectl", verb: "apply", resource: "deployments", name: "web", namespace: "web" },
        ],
      });
    });

    it("blocks a call the user denies, and it never runs", async () => {
      faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "scale web" });
      await waitFor(() => uiRequests().length > 0);
      await answer(host, false);
      await waitFor(settled);

      expect(answerText()).toBe("Result: The user denied the action");
      expect(cli.actions()).toEqual([]);
    });

    it("runs a later Ask call without a card once the user approved all in this chat", async () => {
      faux.setResponses(kubectlCalls(scaleWeb, scaleApi));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "scale web and api" });
      await waitFor(() => uiRequests().length > 0);
      await answer(host, true, true);
      await waitFor(settled);

      expect(autoApproveChanges()).toEqual([{ enabled: true }]);
      expect(uiRequests()).toHaveLength(1);
      expect(cli.actions().map((invocation) => invocation.args)).toEqual([scaleWeb, scaleApi]);
    });

    it("asks before an Always ask call even after the user approved all in this chat", async () => {
      let nextCall!: () => void;
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("kubectl", { args: scaleWeb })], { stopReason: "toolUse" }),
        heldUntil(
          new Promise<void>((resolve) => {
            nextCall = resolve;
          }),
          fauxAssistantMessage([fauxToolCall("kubectl", { args: execWeb })], { stopReason: "toolUse" }),
        ),
        fauxAssistantMessage([fauxText("done")]),
      ]);
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "scale web, then read its config" });
      await waitFor(() => uiRequests().length > 0);
      await answer(host, true, true);
      nextCall();
      await waitFor(() => uiRequests().length > 1);

      expect(uiRequests()[1]).toMatchObject({
        args: execWeb,
        canonicalForms: [{ program: "kubectl", verb: "exec", resource: "pods", name: "web-1", namespace: "default" }],
        level: "alwaysAsk",
        profileName: "Standard",
      });
      expect(cli.actions().map((invocation) => invocation.args)).toEqual([scaleWeb]);

      await answer(host, true);
      await waitFor(settled);
      expect(cli.actions().map((invocation) => invocation.args)).toEqual([scaleWeb, execWeb]);
    });

    it("does not let an Always ask approval turn on approving all in this chat", async () => {
      faux.setResponses(kubectlCalls(execWeb, execWeb));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "read the config twice" });
      await waitFor(() => uiRequests().length > 0);
      expect(await answer(host, true, true)).toMatchObject({ success: true });
      await waitFor(() => uiRequests().length > 1);

      expect(autoApproveChanges()).toEqual([]);
      expect((await snapshotOf(host)).autoApprove).toBe(false);
      expect(cli.actions().map((invocation) => invocation.args)).toEqual([execWeb]);
      await answer(host, false);
      await waitFor(settled);
    });

    it("denies a pending approval on Stop, ends the run, and the call never runs", async () => {
      faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "scale web" });
      await waitFor(() => uiRequests().length > 0);

      expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });
      await waitFor(settled);

      expect(uiResolved()).toEqual([{ id: uiRequests()[0]!.id, confirmed: false }]);
      expect(cli.actions()).toEqual([]);
      const snapshot = await snapshotOf(host);
      expect(snapshot.isStreaming).toBe(false);
      expect(snapshot.pendingUiRequest).toBeUndefined();
    });

    it("reads the profile at each call, so a change applies to the next call", async () => {
      let profile = ALLOW_ALL_PROFILE;
      let nextCall!: () => void;
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("kubectl", { args: scaleWeb })], { stopReason: "toolUse" }),
        heldUntil(
          new Promise<void>((resolve) => {
            nextCall = resolve;
          }),
          fauxAssistantMessage([fauxToolCall("kubectl", { args: scaleApi })], { stopReason: "toolUse" }),
        ),
        fauxAssistantMessage([fauxText("done")]),
      ]);
      const host = kubectlHost({ getPolicyProfile: () => profile });

      await host.handleCommand("c1", { type: "prompt", message: "scale web and api" });
      await waitFor(() => cli.actions().length > 0);
      profile = STANDARD_PROFILE;
      nextCall();
      await waitFor(() => uiRequests().length > 0);

      expect(uiRequests()[0]).toMatchObject({ args: scaleApi, profileName: "Standard" });
      expect(cli.actions().map((invocation) => invocation.args)).toEqual([scaleWeb]);
      await answer(host, false);
      await waitFor(settled);
    });

    describe("the dry-run preview", () => {
      const scaleWebDryRun = [...scaleWeb, "--dry-run=server", "-o", "yaml"].join(" ");
      const readWeb = "get deployments web -n default -o yaml";
      const webYaml = (replicas: number, generation: number) =>
        "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: default\n" +
        `  generation: ${generation}\n  managedFields:\n  - manager: kubectl\n    operation: Update\n` +
        `spec:\n  replicas: ${replicas}\nstatus:\n  readyReplicas: 2\n`;
      const scaleForm = {
        program: "kubectl",
        verb: "scale",
        resource: "deployments",
        name: "web",
        namespace: "default",
      };
      const cliRequests = () => uiRequests().filter(isCliApprovalRequest);
      const toolStarts = () =>
        envelopes.flatMap((e) => (e.kind === "event" && e.payload.type === "tool_execution_start" ? [e.payload] : []));

      it("runs the call as a server-side dry run and shows the diff of its target, without managed fields", async () => {
        cli = createStandInCli({
          answers: { [scaleWebDryRun]: { stdout: webYaml(3, 2) }, [readWeb]: { stdout: webYaml(2, 1) } },
        });
        faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(() => uiRequests().length > 0);

        expect(cli.previews().map((invocation) => invocation.args.join(" "))).toEqual([scaleWebDryRun, readWeb]);
        expect(cli.previews()[0]?.signal).toBeInstanceOf(AbortSignal);
        expect(cliRequests()[0]?.preview).toEqual({
          kind: "diffs",
          diffs: [
            {
              target: scaleForm,
              diff:
                "--- current\n+++ dry run\n@@ -3,8 +3,8 @@\n metadata:\n   name: web\n   namespace: default\n" +
                "-  generation: 1\n+  generation: 2\n spec:\n-  replicas: 2\n+  replicas: 3\n status:\n" +
                "   readyReplicas: 2\n",
            },
          ],
        });
        expect((await snapshotOf(host)).pendingUiRequest).toEqual(uiRequests()[0]);
        expect(toolStarts()).toHaveLength(1);
        await answer(host, false);
        await waitFor(settled);
      });

      it("keeps the preview on the card: neither the tool result nor the chat's file holds it", async () => {
        cli = createStandInCli({
          answers: {
            [scaleWebDryRun]: { stdout: webYaml(3, 2) },
            [readWeb]: { stdout: webYaml(2, 1) },
            [scaleWeb.join(" ")]: { stdout: "deployment.apps/web scaled\n" },
          },
        });
        faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(() => uiRequests().length > 0);
        await answer(host, true);
        await waitFor(settled);

        expect(cli.actions()).toEqual([expect.objectContaining({ args: scaleWeb })]);
        expect(toolResultTexts()).toEqual(["Exit code: 0\n\nStandard output:\ndeployment.apps/web scaled"]);
        const chatFile = readdirSync(join(dataDir, "sessions", "c1")).find((file) => file.endsWith(".jsonl"))!;
        const saved = readFileSync(join(dataDir, "sessions", "c1", chatFile), "utf8");
        expect(saved).toContain("deployment.apps/web scaled");
        expect(saved).not.toContain("readyReplicas");
        expect(saved).not.toContain("dry run");
      });

      it.each([
        ["Invalid", 'The Deployment "web" is invalid: spec.replicas: Invalid value: -1: must be >= 0'],
        ["Forbidden", 'deployments.apps "web" is forbidden: User "dev" cannot patch resource "deployments/scale"'],
        ["NotFound", 'deployments.apps "web" not found'],
        ["AlreadyExists", 'deployments.apps "web" already exists'],
        ["Conflict", 'Operation cannot be fulfilled on deployments.apps "web": the object has been modified'],
      ])(
        "blocks a call whose dry run the server rejects as %s with its message, and asks nobody",
        async (status, text) => {
          const message = `Error from server (${status}): ${text}`;
          cli = createStandInCli({ answers: { [scaleWebDryRun]: { stderr: `${message}\n`, exitCode: 1 } } });
          faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
          const host = kubectlHost();

          await host.handleCommand("c1", { type: "prompt", message: "scale web" });
          await waitFor(settled);

          expect(uiRequests()).toEqual([]);
          expect(toolEnd()).toEqual([expect.objectContaining({ toolName: "kubectl", isError: true })]);
          expect(toolResultTexts()).toEqual([
            `The cluster rejected a server-side dry run of this call, so it did not run: ${message}`,
          ]);
          expect(cli.previews().map((invocation) => invocation.args.join(" "))).toEqual([scaleWebDryRun]);
          expect(cli.actions()).toEqual([]);
        },
      );

      it("blocks a call whose dry run an admission webhook denies", async () => {
        const message =
          'Error from server: admission webhook "validate.kyverno.svc-fail" denied the request: replicas must be odd';
        cli = createStandInCli({ answers: { [scaleWebDryRun]: { stderr: `${message}\n`, exitCode: 1 } } });
        faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(settled);

        expect(uiRequests()).toEqual([]);
        expect(toolResultTexts()).toEqual([
          `The cluster rejected a server-side dry run of this call, so it did not run: ${message}`,
        ]);
        expect(cli.actions()).toEqual([]);
      });

      it.each<[string, Partial<CliResult>, string]>([
        [
          "a webhook without dry-run support",
          {
            stderr: 'Error from server (BadRequest): admission webhook "legacy.example.com" does not support dry run\n',
            exitCode: 1,
          },
          'the dry run failed: Error from server (BadRequest): admission webhook "legacy.example.com" does not support dry run',
        ],
        [
          "a connection error",
          {
            stderr: "Unable to connect to the server: dial tcp 127.0.0.1:6443: connect: connection refused\n",
            exitCode: 1,
          },
          "the dry run failed: Unable to connect to the server: dial tcp 127.0.0.1:6443: connect: connection refused",
        ],
        ["a timeout", { exitCode: null, killed: "timeout" }, "the dry run did not end within its timeout of 30 s"],
        [
          "an internal error",
          {
            stderr: "Error from server (InternalError): Internal error occurred: etcdserver: leader changed\n",
            exitCode: 1,
          },
          "the dry run failed: Error from server (InternalError): Internal error occurred: etcdserver: leader changed",
        ],
        [
          "output it does not recognize",
          { stdout: "deployment.apps/web scaled (server dry run)\n" },
          "kubectl printed a dry run the preview does not recognize",
        ],
      ])(
        "still asks after %s, with Preview unavailable, its reason and the current YAML",
        async (_case, dryRun, reason) => {
          cli = createStandInCli({ answers: { [scaleWebDryRun]: dryRun, [readWeb]: { stdout: webYaml(2, 1) } } });
          faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
          const host = kubectlHost();

          await host.handleCommand("c1", { type: "prompt", message: "scale web" });
          await waitFor(() => uiRequests().length > 0);

          expect(cliRequests()[0]?.preview).toEqual({
            kind: "unavailable",
            reason,
            backup:
              "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: default\n  generation: 1\n" +
              "spec:\n  replicas: 2\nstatus:\n  readyReplicas: 2\n",
          });
          await answer(host, true);
          await waitFor(settled);
          expect(cli.actions()).toEqual([expect.objectContaining({ args: scaleWeb })]);
        },
      );

      it("shows Preview unavailable without a backup when the target does not exist yet", async () => {
        const createArgs = ["create", "configmap", "settings", "--from-literal=mode=fast", "-n", "web"];
        const createDryRun = [...createArgs, "--dry-run=server", "-o", "yaml"].join(" ");
        cli = createStandInCli({
          answers: {
            [createDryRun]: {
              stderr: "Error from server (ServiceUnavailable): the server is currently unable\n",
              exitCode: 1,
            },
            "get configmaps settings -n web -o yaml": {
              stderr: 'Error from server (NotFound): configmaps "settings" not found\n',
              exitCode: 1,
            },
          },
        });
        faux.setResponses(callThenEcho("kubectl", { args: createArgs }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "create the settings" });
        await waitFor(() => uiRequests().length > 0);

        expect(cliRequests()[0]?.preview).toEqual({
          kind: "unavailable",
          reason: "the dry run failed: Error from server (ServiceUnavailable): the server is currently unable",
        });
        await answer(host, false);
        await waitFor(settled);
      });

      it("shows a target that does not exist yet as added in full", async () => {
        const createArgs = ["create", "configmap", "settings", "--from-literal=mode=fast", "-n", "web"];
        const createDryRun = [...createArgs, "--dry-run=server", "-o", "yaml"].join(" ");
        cli = createStandInCli({
          answers: {
            [createDryRun]: {
              stdout:
                "apiVersion: v1\ndata:\n  mode: fast\nkind: ConfigMap\nmetadata:\n  name: settings\n  namespace: web\n",
            },
            "get configmaps settings -n web -o yaml": {
              stderr: 'Error from server (NotFound): configmaps "settings" not found\n',
              exitCode: 1,
            },
          },
        });
        faux.setResponses(callThenEcho("kubectl", { args: createArgs }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "create the settings" });
        await waitFor(() => uiRequests().length > 0);

        expect(cliRequests()[0]?.preview).toEqual({
          kind: "diffs",
          diffs: [
            {
              target: {
                program: "kubectl",
                verb: "create",
                resource: "configmaps",
                name: "settings",
                namespace: "web",
              },
              diff:
                "--- current\n+++ dry run\n@@ -0,0 +1,7 @@\n+apiVersion: v1\n+data:\n+  mode: fast\n+kind: ConfigMap\n" +
                "+metadata:\n+  name: settings\n+  namespace: web\n",
            },
          ],
        });
        await answer(host, false);
        await waitFor(settled);
      });

      it("shows Preview unavailable when the current object cannot be read", async () => {
        cli = createStandInCli({
          answers: {
            [scaleWebDryRun]: { stdout: webYaml(3, 2) },
            [readWeb]: { stderr: "Unable to connect to the server: EOF\n", exitCode: 1 },
          },
        });
        faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(() => uiRequests().length > 0);

        expect(cliRequests()[0]?.preview).toEqual({
          kind: "unavailable",
          reason: "reading kubectl scale deployments web -n default failed: Unable to connect to the server: EOF",
        });
        await answer(host, false);
        await waitFor(settled);
      });

      it("shows a diff per object of a manifest, from the List the dry run prints", async () => {
        const manifest =
          "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n  namespace: web\ndata:\n  mode: slow\n---\n" +
          "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: web\nspec:\n  replicas: 2\n";
        const settings = (mode: string) =>
          `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n  namespace: web\ndata:\n  mode: ${mode}\n`;
        const web = (replicas: number) =>
          `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: web\nspec:\n  replicas: ${replicas}\n`;
        const indent = (yaml: string) =>
          yaml
            .trimEnd()
            .split("\n")
            .map((line, index) => `${index === 0 ? "- " : "  "}${line}\n`)
            .join("");
        cli = createStandInCli({
          answers: {
            "apply -f - --dry-run=server -o yaml": {
              stdout: `apiVersion: v1\nkind: List\nitems:\n${indent(settings("slow"))}${indent(web(2))}`,
            },
            "get configmaps settings -n web -o yaml": { stdout: settings("fast") },
            "get deployments web -n web -o yaml": { stdout: web(2) },
          },
        });
        faux.setResponses(callThenEcho("kubectl", { args: ["apply"], manifest }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "apply it" });
        await waitFor(() => uiRequests().length > 0);

        expect(cli.previews()[0]).toMatchObject({
          args: ["apply", "-f", "-", "--dry-run=server", "-o", "yaml"],
          manifest,
        });
        expect(cliRequests()[0]?.preview).toEqual({
          kind: "diffs",
          diffs: [
            {
              target: { program: "kubectl", verb: "apply", resource: "configmaps", name: "settings", namespace: "web" },
              diff: "--- current\n+++ dry run\n@@ -4,4 +4,4 @@\n   name: settings\n   namespace: web\n data:\n-  mode: fast\n+  mode: slow\n",
            },
            {
              target: { program: "kubectl", verb: "apply", resource: "deployments", name: "web", namespace: "web" },
              diff: "",
            },
          ],
        });
        await answer(host, false);
        await waitFor(settled);
      });

      it("shows a named object a delete would remove as removed in full", async () => {
        const deleteArgs = ["delete", "configmap", "settings", "-n", "web"];
        cli = createStandInCli({
          answers: {
            [[...deleteArgs, "--dry-run=server", "-o", "name"].join(" ")]: { stdout: "configmap/settings\n" },
            "get configmaps settings -n web -o yaml": {
              stdout: "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n  namespace: web\n",
            },
          },
        });
        faux.setResponses(callThenEcho("kubectl", { args: deleteArgs }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "delete the settings" });
        await waitFor(() => uiRequests().length > 0);

        expect(cliRequests()[0]?.preview).toEqual({
          kind: "diffs",
          diffs: [
            {
              target: {
                program: "kubectl",
                verb: "delete",
                resource: "configmaps",
                name: "settings",
                namespace: "web",
              },
              diff:
                "--- current\n+++ dry run\n@@ -1,5 +0,0 @@\n-apiVersion: v1\n-kind: ConfigMap\n-metadata:\n" +
                "-  name: settings\n-  namespace: web\n",
            },
          ],
        });
        await answer(host, false);
        await waitFor(settled);
      });

      it("lists the objects a delete by selector would remove, without reading them", async () => {
        const deleteArgs = ["delete", "pods", "-l", "app=web", "-n", "web"];
        const names = Array.from({ length: 52 }, (_, index) => `pod/web-${index}`);
        cli = createStandInCli({
          answers: {
            [[...deleteArgs, "--dry-run=server", "-o", "name"].join(" ")]: { stdout: `${names.join("\n")}\n` },
          },
        });
        faux.setResponses(callThenEcho("kubectl", { args: deleteArgs }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "delete the web pods" });
        await waitFor(() => uiRequests().length > 0);

        const listed = Array.from({ length: 50 }, (_, index) => `pods/web-${index}`).join(", ");
        expect(cliRequests()[0]?.preview).toEqual({
          kind: "unavailable",
          reason:
            "the targets are not all named (a selector, --all or no name), so their current objects are not read; " +
            `the dry run reports 52 objects: ${listed} and 2 more`,
        });
        expect(cli.previews()).toHaveLength(1);
        await answer(host, false);
        await waitFor(settled);
      });

      it("lists the objects of a dry run by selector by their resource", async () => {
        const labelArgs = ["label", "deployments", "-l", "app=web", "tier=front"];
        cli = createStandInCli({
          answers: {
            [[...labelArgs, "--dry-run=server", "-o", "yaml"].join(" ")]: {
              stdout:
                "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: default\n---\n" +
                "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n  namespace: default\n",
            },
          },
        });
        faux.setResponses(callThenEcho("kubectl", { args: labelArgs }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "label them" });
        await waitFor(() => uiRequests().length > 0);

        expect(cliRequests()[0]?.preview).toMatchObject({
          kind: "unavailable",
          reason: expect.stringMatching(/; the dry run reports 2 objects: deployments\/web, deployments\/api$/),
        });
        await answer(host, false);
        await waitFor(settled);
      });

      it("runs the dry run of a verb without -o and shows the current YAML as the backup", async () => {
        const nodeYaml = "apiVersion: v1\nkind: Node\nmetadata:\n  name: node-1\nspec:\n  podCIDR: 10.244.0.0/24\n";
        cli = createStandInCli({
          answers: {
            "cordon node-1 --dry-run=server": { stdout: "node/node-1 cordoned (server dry run)\n" },
            "get nodes node-1 -o yaml": { stdout: nodeYaml },
          },
        });
        faux.setResponses(callThenEcho("kubectl", { args: ["cordon", "node-1"] }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "cordon node-1" });
        await waitFor(() => uiRequests().length > 0);

        expect(cliRequests()[0]?.preview).toEqual({
          kind: "unavailable",
          reason: "kubectl cordon prints no object in a dry run",
          backup: nodeYaml,
        });
        await answer(host, false);
        await waitFor(settled);
      });

      it("makes no preview for a verb without a server-side dry run", async () => {
        faux.setResponses(callThenEcho("kubectl", { args: ["rollout", "restart", "deployment/web"] }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "restart web" });
        await waitFor(() => uiRequests().length > 0);

        expect(cliRequests()[0]).not.toHaveProperty("preview");
        expect(cli.previews()).toEqual([]);
        await answer(host, false);
        await waitFor(settled);
      });

      it("runs no dry run for a call the profile allows, nor for one approved by approving all in this chat", async () => {
        faux.setResponses(kubectlCalls(scaleWeb, scaleApi));
        const host = kubectlHost({ getPolicyProfile: () => ALLOW_ALL_PROFILE });

        await host.handleCommand("c1", { type: "prompt", message: "scale web and api" });
        await waitFor(settled);

        expect(cli.previews()).toEqual([]);
        expect(cli.actions().map((invocation) => invocation.args)).toEqual([scaleWeb, scaleApi]);
      });

      it("runs no dry run for an Ask call once the user approved all in this chat", async () => {
        faux.setResponses(kubectlCalls(scaleWeb, scaleApi));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "scale web and api" });
        await waitFor(() => uiRequests().length > 0);
        await answer(host, true, true);
        await waitFor(settled);

        expect(cli.previews().map((invocation) => invocation.args.join(" "))).toEqual([scaleWebDryRun, readWeb]);
        expect(cli.actions().map((invocation) => invocation.args)).toEqual([scaleWeb, scaleApi]);
      });

      it("ends the dry run on Stop, shows no card, and the call never runs", async () => {
        cli = createStandInCli({ hang: [scaleWebDryRun] });
        faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(() => cli.previews().length > 0);
        expect(cli.previews()[0]?.signal?.aborted).toBe(false);

        expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });
        await waitFor(settled);

        expect(cli.previews()[0]?.signal?.aborted).toBe(true);
        expect(cli.previews()).toHaveLength(1);
        expect(uiRequests()).toEqual([]);
        expect(cli.actions()).toEqual([]);
        expect((await snapshotOf(host)).isStreaming).toBe(false);
      });
    });

    describe("the resources of the cluster", () => {
      it("reads the cluster's resources and namespace once for the chat, before its first call", async () => {
        cli = createStandInCli({
          answers: { "get pods": { stdout: "web-1\n" }, "get ks -n flux-system": { stdout: "flux-system\n" } },
        });
        faux.setResponses(kubectlCalls(["get", "pods"], ["get", "ks", "-n", "flux-system"]));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "pods and kustomizations" });
        await waitFor(settled);

        expect(uiRequests()).toEqual([]);
        expect(cli.invocations).toEqual([
          expect.objectContaining({ clusterId: "c1", program: "kubectl", args: API_RESOURCES_ARGS, timeoutMs: 30_000 }),
          expect.objectContaining({ clusterId: "c1", program: "kubectl", args: KUBECONFIG_NAMESPACE_ARGS }),
          expect.objectContaining({ args: ["get", "pods"] }),
          expect.objectContaining({ args: ["get", "ks", "-n", "flux-system"] }),
        ]);
        expect(cli.invocations[0]?.signal).toBeInstanceOf(AbortSignal);
      });

      it("reads the resources again when a call names one the chat has not seen, and then runs it", async () => {
        const answers: Record<string, Partial<CliResult>> = { "get pods": { stdout: "web-1\n" } };
        cli = createStandInCli({ answers });
        let nextCall!: () => void;
        faux.setResponses([
          fauxAssistantMessage([fauxToolCall("kubectl", { args: ["get", "pods"] })], { stopReason: "toolUse" }),
          heldUntil(
            new Promise<void>((resolve) => {
              nextCall = resolve;
            }),
            fauxAssistantMessage([fauxToolCall("kubectl", { args: ["get", "helmreleases", "-A"] })], {
              stopReason: "toolUse",
            }),
          ),
          fauxAssistantMessage([fauxText("done")]),
        ]);
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "pods, then releases" });
        await waitFor(() => cli.actions().length > 0);
        // Flux's helm-controller was installed meanwhile.
        answers[API_RESOURCES_KEY] = {
          stdout: apiResourcesTable([
            ...STAND_IN_RESOURCES,
            ["helmreleases", "hr", "helm.toolkit.fluxcd.io/v2", true, "HelmRelease"],
          ]),
        };
        answers["get helmreleases -A"] = { stdout: "podinfo\n" };
        nextCall();
        await waitFor(settled);

        expect(cli.invocations.map((invocation) => invocation.args.join(" "))).toEqual([
          API_RESOURCES_KEY,
          KUBECONFIG_NAMESPACE_KEY,
          "get pods",
          API_RESOURCES_KEY,
          "get helmreleases -A",
        ]);
        expect(uiRequests()).toEqual([]);
      });

      it("blocks a call whose resource the cluster does not serve after reading the resources again", async () => {
        cli = createStandInCli({ answers: { "get pods": { stdout: "web-1\n" } } });
        faux.setResponses(kubectlCalls(["get", "pods"], ["get", "frobnicators"]));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "pods and frobnicators?" });
        await waitFor(settled);

        expect(cli.invocations.map((invocation) => invocation.args.join(" "))).toEqual([
          API_RESOURCES_KEY,
          KUBECONFIG_NAMESPACE_KEY,
          "get pods",
          API_RESOURCES_KEY,
        ]);
        expect(toolResultTexts()[1]).toMatch(/^Blocked by the floor.* Resources the cluster does not serve: /);
      });

      it("reads the resources only once for the chat's first call, even when it names one they lack", async () => {
        faux.setResponses(callThenEcho("kubectl", { args: ["get", "frobnicators"] }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "frobnicators?" });
        await waitFor(settled);

        expect(cli.invocations.map((invocation) => invocation.args.join(" "))).toEqual([
          API_RESOURCES_KEY,
          KUBECONFIG_NAMESPACE_KEY,
        ]);
        expect(toolResultTexts()[0]).toMatch(/^Blocked by the floor.* Resources the cluster does not serve: /);
      });

      it("gives a target without -n the namespace the cluster's kubeconfig selects", async () => {
        cli = createStandInCli({ answers: { [KUBECONFIG_NAMESPACE_KEY]: { stdout: "team-a" } } });
        faux.setResponses(callThenEcho("kubectl", { args: scaleWeb }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(() => uiRequests().length > 0);

        expect(uiRequests()[0]).toMatchObject({
          canonicalForms: [{ verb: "scale", resource: "deployments", name: "web", namespace: "team-a" }],
        });
        await answer(host, false);
        await waitFor(settled);
      });

      it("blocks the call when the cluster's resources cannot be read", async () => {
        cli = createStandInCli({
          answers: { [API_RESOURCES_KEY]: { stderr: "error: You must be logged in to the server\n", exitCode: 1 } },
        });
        faux.setResponses(callThenEcho("kubectl", { args: ["get", "pods"] }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "pods?" });
        await waitFor(settled);

        expect(toolResultTexts()).toEqual([
          "Could not read the resources the cluster serves: kubectl api-resources listed no resources: " +
            "error: You must be logged in to the server",
        ]);
        expect(cli.actions()).toEqual([]);
      });
    });

    describe("the cli_policy section", () => {
      const sectionsSeen: Record<string, string>[] = [];
      const recordSections: FauxFactory = (context) => {
        const sections: Record<string, string> = {};
        for (const message of context.messages) {
          if (message.role !== "system") continue;
          for (const [name, text] of Object.entries(message.sections ?? {})) {
            if (text === null) delete sections[name];
            else sections[name] = text;
          }
        }
        sectionsSeen.push(sections);
        return fauxAssistantMessage([fauxText("ok")]);
      };
      const ask = async (host: AgentHost) => {
        const before = envelopes.length;
        await host.handleCommand("c1", { type: "prompt", message: "hi" });
        await waitFor(() =>
          envelopes.slice(before).some((e) => e.kind === "event" && e.payload.type === "agent_settled"),
        );
      };

      beforeEach(() => {
        sectionsSeen.length = 0;
      });

      it("names the cluster's profile, lists its rules and fallback level, and summarizes the floor", async () => {
        faux.setResponses([recordSections]);
        const host = kubectlHost();

        await ask(host);

        const section = sectionsSeen[0]?.cli_policy ?? "";
        expect(section).toMatch(/^<cli_policy>\n[\s\S]*\n<\/cli_policy>$/);
        expect(section).toContain('The policy profile of this cluster is "Standard".');
        expect(section).toContain("- kubectl get *: Allow\n");
        expect(section).toContain("- kubectl logs *: Ask\n");
        expect(section).toContain("- kubectl exec *: Always ask\n");
        expect(section).toContain("- kubectl delete namespaces *: Always ask\n");
        expect(section).toContain("Fallback level: Ask");
        expect(section).toMatch(/- Flags that change the cluster or the identity: --kubeconfig, --context/);
        expect(section).toMatch(/- Invocations that never end or need a terminal: proxy, port-forward/);
      });

      it("reads the profile before every run", async () => {
        faux.setResponses([recordSections, recordSections]);
        let profile = STANDARD_PROFILE;
        const host = kubectlHost({ getPolicyProfile: () => profile });

        await ask(host);
        profile = READ_ONLY_PROFILE;
        await ask(host);

        expect(
          sectionsSeen.map((sections) => sections.cli_policy?.match(/profile of this cluster is "([^"]+)"/)?.[1]),
        ).toEqual(["Standard", "Read only"]);
        expect(sectionsSeen[1]?.cli_policy).toContain("Fallback level: Deny");
      });

      it("is not set for an agent without the kubectl tool", async () => {
        faux.setResponses([recordSections]);
        const host = createHost();

        await ask(host);

        expect(sectionsSeen[0]).not.toHaveProperty("cli_policy");
      });
    });
  });

  describe("Secret redaction", () => {
    const uiRequests = () => envelopes.flatMap((e) => (e.kind === "ui_request" ? [e.payload] : []));
    const toolResultText = () =>
      (toolEnd()[0]?.result.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
    const kubectlHost = (overrides: Partial<AgentHostOptions> = {}) =>
      createHost({ tools: [kubectlTool], getPolicyProfile: () => ALLOW_ALL_PROFILE, ...overrides });
    const REDACTION_NOTE =
      "Secret values are redacted: each value of data and stringData, and the annotation " +
      "kubectl.kubernetes.io/last-applied-configuration, is replaced by its size. Set revealSecrets to read them.";
    // "hunter22" and "admin" in base64; kubectl prints JSON with four spaces.
    const DB_SECRET = {
      apiVersion: "v1",
      data: { password: "aHVudGVyMjI=", username: "YWRtaW4=" },
      kind: "Secret",
      metadata: { name: "db", namespace: "web" },
      type: "Opaque",
    };
    const json = (value: unknown) => `${JSON.stringify(value, null, 4)}\n`;

    it("runs a get of one Secret with -o json and prints it as YAML with each value replaced by its size", async () => {
      cli = createStandInCli({ answers: { "get secrets db -n web -o json": { stdout: json(DB_SECRET) } } });
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "secrets", "db", "-n", "web", "-o", "yaml"] }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "show the db secret" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([
        expect.objectContaining({ args: ["get", "secrets", "db", "-n", "web", "-o", "json"] }),
      ]);
      expect(toolEnd()).toEqual([expect.objectContaining({ isError: false })]);
      expect(toolResultText()).toBe(
        `Exit code: 0\n\n${REDACTION_NOTE}\n\nStandard output:\n` +
          "apiVersion: v1\n" +
          "data:\n" +
          "  password: redacted, 8 bytes\n" +
          "  username: redacted, 5 bytes\n" +
          "kind: Secret\n" +
          "metadata:\n" +
          "  name: db\n" +
          "  namespace: web\n" +
          "type: Opaque",
      );
    });

    it("redacts the Secrets of a list mixed with other resources and prints it as JSON, the others as they are", async () => {
      const settings = {
        apiVersion: "v1",
        data: { mode: "fast" },
        kind: "ConfigMap",
        metadata: { name: "settings", namespace: "web" },
      };
      const list = { apiVersion: "v1", items: [DB_SECRET, settings], kind: "List", metadata: { resourceVersion: "" } };
      cli = createStandInCli({ answers: { "get secrets,configmaps -n web -o json": { stdout: json(list) } } });
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "secrets,configmaps", "-n", "web", "-o", "json"] }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "show the secrets and config maps" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([
        expect.objectContaining({ args: ["get", "secrets,configmaps", "-n", "web", "-o", "json"] }),
      ]);
      expect(toolResultText()).toBe(
        `Exit code: 0\n\n${REDACTION_NOTE}\n\nStandard output:\n` +
          "{\n" +
          '    "apiVersion": "v1",\n' +
          '    "items": [\n' +
          "        {\n" +
          '            "apiVersion": "v1",\n' +
          '            "data": {\n' +
          '                "password": "redacted, 8 bytes",\n' +
          '                "username": "redacted, 5 bytes"\n' +
          "            },\n" +
          '            "kind": "Secret",\n' +
          '            "metadata": {\n' +
          '                "name": "db",\n' +
          '                "namespace": "web"\n' +
          "            },\n" +
          '            "type": "Opaque"\n' +
          "        },\n" +
          "        {\n" +
          '            "apiVersion": "v1",\n' +
          '            "data": {\n' +
          '                "mode": "fast"\n' +
          "            },\n" +
          '            "kind": "ConfigMap",\n' +
          '            "metadata": {\n' +
          '                "name": "settings",\n' +
          '                "namespace": "web"\n' +
          "            }\n" +
          "        }\n" +
          "    ],\n" +
          '    "kind": "List",\n' +
          '    "metadata": {\n' +
          '        "resourceVersion": ""\n' +
          "    }\n" +
          "}",
      );
    });

    describe("the annotation kubectl apply leaves on a Secret", () => {
      // What client-side apply records: the whole manifest, values included, 114 bytes.
      const lastApplied =
        '{"apiVersion":"v1","data":{"password":"aHVudGVyMjI="},"kind":"Secret","metadata":{"name":"db","namespace":"web"}}\n';
      const APPLIED_SECRET = {
        apiVersion: "v1",
        data: { password: "aHVudGVyMjI=" },
        kind: "Secret",
        metadata: {
          annotations: { "kubectl.kubernetes.io/last-applied-configuration": lastApplied, team: "web" },
          managedFields: [
            {
              fieldsType: "FieldsV1",
              fieldsV1: { "f:data": { ".": {}, "f:password": {} }, "f:type": {} },
              manager: "kubectl-client-side-apply",
              operation: "Update",
            },
          ],
          name: "db",
          namespace: "web",
        },
        type: "Opaque",
      };

      it("is replaced by its size on a single Secret, its other annotations and its managed fields kept", async () => {
        const args = ["get", "secret", "db", "-n", "web", "-o", "yaml", "--show-managed-fields"];
        cli = createStandInCli({
          answers: { "get secret db -n web --show-managed-fields -o json": { stdout: json(APPLIED_SECRET) } },
        });
        faux.setResponses(callThenEcho("kubectl", { args }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "show the db secret" });
        await waitFor(settled);

        expect(toolResultText()).toBe(
          `Exit code: 0\n\n${REDACTION_NOTE}\n\nStandard output:\n` +
            "apiVersion: v1\n" +
            "data:\n" +
            "  password: redacted, 8 bytes\n" +
            "kind: Secret\n" +
            "metadata:\n" +
            "  annotations:\n" +
            "    kubectl.kubernetes.io/last-applied-configuration: redacted, 114 bytes\n" +
            "    team: web\n" +
            "  managedFields:\n" +
            "    - fieldsType: FieldsV1\n" +
            "      fieldsV1:\n" +
            "        f:data:\n" +
            "          .: {}\n" +
            "          f:password: {}\n" +
            "        f:type: {}\n" +
            "      manager: kubectl-client-side-apply\n" +
            "      operation: Update\n" +
            "  name: db\n" +
            "  namespace: web\n" +
            "type: Opaque",
        );
      });

      it("is replaced by its size on the Secrets of a list", async () => {
        const list = { apiVersion: "v1", items: [APPLIED_SECRET], kind: "List", metadata: { resourceVersion: "" } };
        cli = createStandInCli({ answers: { "get secrets -n web -o json": { stdout: json(list) } } });
        faux.setResponses(callThenEcho("kubectl", { args: ["get", "secrets", "-n", "web", "-o", "json"] }));
        const host = kubectlHost();

        await host.handleCommand("c1", { type: "prompt", message: "show the secrets" });
        await waitFor(settled);

        const text = toolResultText();
        expect(text).toContain('"kubectl.kubernetes.io/last-applied-configuration": "redacted, 114 bytes"');
        expect(text).toContain('"password": "redacted, 8 bytes"');
        expect(text).not.toContain("aHVudGVyMjI=");
      });
    });

    it.each<[string, string[]]>([
      ["no -o", ["get", "secrets", "-n", "web"]],
      ["-o wide", ["get", "secrets", "-n", "web", "-o", "wide"]],
      ["-o name", ["get", "secrets", "-n", "web", "-o", "name"]],
    ])("runs a get of Secrets with %s as asked, since a table shows no values", async (_case, args) => {
      const stdout = "NAME   TYPE     DATA   AGE\ndb     Opaque   2      3d\n";
      cli = createStandInCli({ answers: { [args.join(" ")]: { stdout } } });
      faux.setResponses(callThenEcho("kubectl", { args }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "list the secrets" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([expect.objectContaining({ args })]);
      expect(toolResultText()).toBe(
        "Exit code: 0\n\nStandard output:\nNAME   TYPE     DATA   AGE\ndb     Opaque   2      3d",
      );
    });

    it.each<[string[], string[]]>([
      [
        ["get", "secret/db", "-oyaml", "-n", "web"],
        ["get", "secret/db", "-n", "web", "-o", "json"],
      ],
      [
        ["get", "secret/db", "--output=yaml", "-n", "web"],
        ["get", "secret/db", "-n", "web", "-o", "json"],
      ],
      [
        ["get", "secret/db", "--output", "yaml", "-n", "web"],
        ["get", "secret/db", "-n", "web", "-o", "json"],
      ],
      [
        ["get", "secret/db", "-o", "kyaml", "-n", "web"],
        ["get", "secret/db", "-n", "web", "-o", "json"],
      ],
    ])("runs kubectl %j as %j and prints the result as YAML", async (args, run) => {
      cli = createStandInCli({ answers: { [run.join(" ")]: { stdout: json(DB_SECRET) } } });
      faux.setResponses(callThenEcho("kubectl", { args }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "show the db secret" });
      await waitFor(settled);

      expect(cli.actions()).toEqual([expect.objectContaining({ args: run })]);
      expect(toolResultText()).toContain("Standard output:\napiVersion: v1\ndata:\n  password: redacted, 8 bytes\n");
    });

    it("withholds an output that is not JSON, since its values cannot be found", async () => {
      cli = createStandInCli({
        answers: { "get secrets db -n web -o json": { stdout: "password: aHVudGVyMjI=\n" } },
      });
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "secrets", "db", "-n", "web", "-o", "json"] }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "show the db secret" });
      await waitFor(settled);

      expect(toolResultText()).toBe(
        `Exit code: 0\n\n${REDACTION_NOTE}\n\nStandard output:\n` +
          "(withheld: the output was not JSON, so the values of its Secrets could not be redacted)",
      );
    });

    it("keeps the standard error of a get of Secrets that failed", async () => {
      const stderr = 'Error from server (NotFound): secrets "gone" not found\n';
      cli = createStandInCli({ answers: { "get secrets gone -n web -o json": { stderr, exitCode: 1 } } });
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "secrets", "gone", "-n", "web", "-o", "yaml"] }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "show the gone secret" });
      await waitFor(settled);

      expect(toolEnd()).toEqual([expect.objectContaining({ isError: true })]);
      expect(toolResultText()).toBe(
        `Exit code: 1\n\n${REDACTION_NOTE}\n\nStandard output: (empty)\n\n` +
          'Standard error:\nError from server (NotFound): secrets "gone" not found',
      );
    });

    it("applies grep to the redacted output", async () => {
      cli = createStandInCli({ answers: { "get secrets db -n web -o json": { stdout: json(DB_SECRET) } } });
      faux.setResponses(
        callThenEcho("kubectl", { args: ["get", "secrets", "db", "-n", "web", "-o", "yaml"], grep: "password" }),
      );
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "how long is the password?" });
      await waitFor(settled);

      expect(toolResultText()).toBe(
        `Exit code: 0\n\n${REDACTION_NOTE}\n\nStandard output:\n  password: redacted, 8 bytes`,
      );
    });

    describe("revealSecrets", () => {
      const revealArgs = ["get", "secrets", "db", "-n", "web", "-o", "jsonpath={.data.password}"];
      const answer = (host: AgentHost, confirmed: boolean) =>
        host.handleCommand("c1", { type: "ui_response", id: uiRequests()[0]!.id, confirmed });

      it("asks under Standard with a reveal target, and runs the call as asked, unredacted, once approved", async () => {
        cli = createStandInCli({ answers: { [revealArgs.join(" ")]: { stdout: "aHVudGVyMjI=" } } });
        faux.setResponses(callThenEcho("kubectl", { args: revealArgs, revealSecrets: true }));
        const host = kubectlHost({ getPolicyProfile: () => STANDARD_PROFILE });

        await host.handleCommand("c1", { type: "prompt", message: "what is the db password?" });
        await waitFor(() => uiRequests().length > 0);

        expect(uiRequests()[0]).toMatchObject({
          args: revealArgs,
          canonicalForms: [{ program: "kubectl", verb: "reveal", resource: "secrets", name: "db", namespace: "web" }],
          level: "ask",
          profileName: "Standard",
        });
        expect(cli.actions()).toEqual([]);

        await answer(host, true);
        await waitFor(settled);

        expect(cli.actions()).toEqual([expect.objectContaining({ args: revealArgs })]);
        expect(toolResultText()).toBe("Exit code: 0\n\nStandard output:\naHVudGVyMjI=");
      });

      it("never runs a reveal the user denies", async () => {
        faux.setResponses(callThenEcho("kubectl", { args: revealArgs, revealSecrets: true }));
        const host = kubectlHost({ getPolicyProfile: () => STANDARD_PROFILE });

        await host.handleCommand("c1", { type: "prompt", message: "what is the db password?" });
        await waitFor(() => uiRequests().length > 0);
        await answer(host, false);
        await waitFor(settled);

        expect(toolResultText()).toBe("The user denied the action");
        expect(cli.actions()).toEqual([]);
      });
    });

    it("blocks a value-printing format on Secrets without revealSecrets by the floor, and the call never runs", async () => {
      faux.setResponses(callThenEcho("kubectl", { args: ["get", "secrets", "db", "-o", "jsonpath={.data}"] }));
      const host = kubectlHost();

      await host.handleCommand("c1", { type: "prompt", message: "show the values" });
      await waitFor(settled);

      expect(toolEnd()).toEqual([expect.objectContaining({ isError: true })]);
      expect(toolResultText()).toMatch(
        /^Blocked by the floor, which no policy profile lifts\. .*a get of Secrets cannot use -o jsonpath without revealSecrets/,
      );
      expect(cli.actions()).toEqual([]);
    });
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

  // A run whose tool call waits on the cluster until the run stops.
  const runThatHangs = () => {
    cluster = standInCluster({ hang: ["/version"] });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("getClusterVersion", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("done")]),
    ]);
  };
  const clusterAsked = () => cluster.requests.length > 0;
  const snapshotOf = async (host: AgentHost, clusterId = "c1") => {
    const response = await host.handleCommand(clusterId, { type: "get_snapshot" });
    if (!response.success) throw new Error(response.error);
    return response.data as AgentSnapshot;
  };

  it("answers abort when nothing is running", async () => {
    const host = createHost();
    expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });
  });

  it("snapshots a run in progress with its current seq and no tool requests", async () => {
    runThatHangs();
    const host = createHost();

    await host.handleCommand("c1", { type: "prompt", message: "which version?" });
    await waitFor(clusterAsked);

    const snapshot = await snapshotOf(host);
    expect(snapshot.isStreaming).toBe(true);
    expect(snapshot.seq).toBe(envelopes[envelopes.length - 1]?.seq);
    expect(snapshot.sessionId).toBe(envelopes[0]?.sessionId);
    expect(snapshot).not.toHaveProperty("pendingToolRequests");
    expect(snapshot.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(snapshot.autoApprove).toBe(false);
  });

  it("snapshots the tool calls with their results, so a remounted frame shows them", async () => {
    faux.setResponses(callThenEcho("getClusterVersion", {}));
    const host = createHost();

    await host.handleCommand("c1", { type: "prompt", message: "which version?" });
    await waitFor(settled);

    const snapshot = await snapshotOf(host);
    expect(snapshot.messages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    expect(snapshot.messages[1]).toMatchObject({
      content: [{ type: "toolCall", name: "getClusterVersion", arguments: {} }],
    });
    const call = snapshot.messages[1]?.role === "assistant" ? snapshot.messages[1].content[0] : undefined;
    expect(snapshot.messages[2]).toMatchObject({
      toolCallId: call?.type === "toolCall" ? call.id : "",
      toolName: "getClusterVersion",
      isError: false,
      content: [{ type: "text", text: '{"version":"v1.31.2","major":"1","minor":"31"}' }],
    });
  });

  it("snapshots an empty chat for a cluster that never ran", async () => {
    const host = createHost();
    const snapshot = await snapshotOf(host, "fresh");

    expect(snapshot).toMatchObject({ messages: [], isStreaming: false, seq: 0 });
    expect(snapshot).not.toHaveProperty("pendingToolRequests");
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

  describe("per-prompt sections", () => {
    // The sections the model holds when it answers: pi sends the full set in
    // the first system message and later system messages patch it, with null
    // removing a section.
    const sectionsSeen: Record<string, string>[] = [];
    const recordSections: FauxFactory = (context) => {
      const sections: Record<string, string> = {};
      for (const message of context.messages) {
        if (message.role !== "system") continue;
        for (const [name, text] of Object.entries(message.sections ?? {})) {
          if (text === null) delete sections[name];
          else sections[name] = text;
        }
      }
      sectionsSeen.push(sections);
      return fauxAssistantMessage([fauxText("ok")]);
    };

    beforeEach(() => {
      sectionsSeen.length = 0;
    });

    const ask = async (host: AgentHost, clusterId = "c1") => {
      const before = envelopes.length;
      await host.handleCommand(clusterId, { type: "prompt", message: "hi" });
      await waitFor(() =>
        envelopes.slice(before).some((e) => e.kind === "event" && e.payload.type === "agent_settled"),
      );
    };

    it("tells the model the cluster's name and the user's rules", async () => {
      faux.setResponses([recordSections]);
      const host = createHost({
        getClusterName: (clusterId) => (clusterId === "c1" ? "prod-eu-1" : undefined),
        getUserRules: () => "  Answer in Italian.  ",
      });

      await ask(host);

      expect(sectionsSeen[0].cluster).toBe("<cluster>\nprod-eu-1\n</cluster>");
      expect(sectionsSeen[0].user_rules).toBe("<user_rules>\nAnswer in Italian.\n</user_rules>");
    });

    // pi 1.2 changed before_agent_start into a union on the run's message type;
    // a run started by a user message must keep both sections through its tool calls.
    it("keeps the cluster's name and the user's rules on every model request of a run with a tool call", async () => {
      faux.setResponses([
        (context, options, state, model) => {
          recordSections(context, options, state, model);
          return fauxAssistantMessage([fauxToolCall("getClusterVersion", {})], { stopReason: "toolUse" });
        },
        recordSections,
      ]);
      const host = createHost({
        getClusterName: () => "prod-eu-1",
        getUserRules: () => "Answer in Italian.",
      });

      await host.handleCommand("c1", { type: "prompt", message: "which version?" });
      await waitFor(settled);

      expect(sectionsSeen).toHaveLength(2);
      for (const sections of sectionsSeen) {
        expect(sections.cluster).toBe("<cluster>\nprod-eu-1\n</cluster>");
        expect(sections.user_rules).toBe("<user_rules>\nAnswer in Italian.\n</user_rules>");
      }
    });

    it("applies an edit to the rules from the next prompt and drops the section once they are empty", async () => {
      faux.setResponses([recordSections, recordSections, recordSections]);
      let rules = "Answer in Italian.";
      const host = createHost({ getUserRules: () => rules });

      await ask(host);
      rules = "Answer in French.";
      await ask(host);
      rules = "   ";
      await ask(host);

      expect(sectionsSeen.map((sections) => sections.user_rules)).toEqual([
        "<user_rules>\nAnswer in Italian.\n</user_rules>",
        "<user_rules>\nAnswer in French.\n</user_rules>",
        undefined,
      ]);
    });

    it("reads the cluster name on every prompt", async () => {
      faux.setResponses([recordSections, recordSections]);
      let name = "staging";
      const host = createHost({ getClusterName: () => name });

      await ask(host);
      name = "staging-renamed";
      await ask(host);

      expect(sectionsSeen.map((sections) => sections.cluster)).toEqual([
        "<cluster>\nstaging\n</cluster>",
        "<cluster>\nstaging-renamed\n</cluster>",
      ]);
    });

    it("sets neither section when the name is unknown and there are no rules", async () => {
      faux.setResponses([recordSections]);
      const host = createHost({ getClusterName: () => undefined, getUserRules: () => "" });

      await ask(host);

      expect(sectionsSeen[0]).not.toHaveProperty("cluster");
      expect(sectionsSeen[0]).not.toHaveProperty("user_rules");
    });

    it("sends the merged prompt by default", async () => {
      faux.setResponses([recordSections]);
      const host = createHost();

      await ask(host);

      expect(sectionsSeen[0].preamble).toContain("Freelens AI");
      expect(sectionsSeen[0].preamble).toContain("<log_reading>");
    });
  });

  describe("model and thinking level", () => {
    let models: Faux;

    beforeEach(() => {
      models = fauxProvider({
        provider: "faux-models",
        tokensPerSecond: 100_000,
        models: [{ id: "fast" }, { id: "deep", reasoning: true }],
      });
      modelRuntime.registerNativeProvider(models.provider);
    });

    const answerWith = (seen: { model: string; reasoning?: string }[]) => {
      const step = (
        _context: unknown,
        options: { reasoning?: string } | undefined,
        _state: unknown,
        model: { id: string },
      ) => {
        seen.push({ model: model.id, reasoning: options?.reasoning });
        return fauxAssistantMessage([fauxText("ok")]);
      };
      return [step, step, step];
    };

    const promptAndSettle = async (host: AgentHost, message: string) => {
      const before = eventTypes().filter((type) => type === "agent_settled").length;
      const response = await host.handleCommand("c1", { type: "prompt", message });
      expect(response).toMatchObject({ success: true });
      await waitFor(() => eventTypes().filter((type) => type === "agent_settled").length > before);
    };

    it("switches the model between prompts of one chat", async () => {
      const seen: { model: string }[] = [];
      models.setResponses(answerWith(seen));
      let ref = { provider: "faux-models", id: "fast" };
      const host = createHost({ getModelRef: () => ref });

      await promptAndSettle(host, "first");
      ref = { provider: "faux-models", id: "deep" };
      await promptAndSettle(host, "second");

      expect(seen.map((call) => call.model)).toEqual(["fast", "deep"]);
    });

    it("sends the thinking level read before each prompt", async () => {
      const seen: { model: string; reasoning?: string }[] = [];
      models.setResponses(answerWith(seen));
      let level: "low" | "high" = "high";
      const host = createHost({
        getModelRef: () => ({ provider: "faux-models", id: "deep" }),
        getThinkingLevel: () => level,
      });

      await promptAndSettle(host, "first");
      level = "low";
      await promptAndSettle(host, "second");

      expect(seen.map((call) => call.reasoning)).toEqual(["high", "low"]);
    });

    it("keeps the chosen level for a reasoning model after a model without reasoning", async () => {
      const seen: { model: string; reasoning?: string }[] = [];
      models.setResponses(answerWith(seen));
      let ref = { provider: "faux-models", id: "fast" };
      const host = createHost({ getModelRef: () => ref, getThinkingLevel: () => "high" });

      await promptAndSettle(host, "first");
      ref = { provider: "faux-models", id: "deep" };
      await promptAndSettle(host, "second");

      expect(seen).toEqual([
        { model: "fast", reasoning: undefined },
        { model: "deep", reasoning: "high" },
      ]);
    });

    it("sends no reasoning when the thinking level is off", async () => {
      const seen: { model: string; reasoning?: string }[] = [];
      models.setResponses(answerWith(seen));
      const host = createHost({
        getModelRef: () => ({ provider: "faux-models", id: "deep" }),
        getThinkingLevel: () => "off",
      });

      await promptAndSettle(host, "first");

      expect(seen).toEqual([{ model: "deep", reasoning: undefined }]);
    });
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
      runThatHangs();
      const host = createHost();
      await host.handleCommand("c1", { type: "prompt", message: "which version?" });
      await waitFor(clusterAsked);

      const response = await host.handleCommand("c1", { type: "new_session" });

      expect(response).toMatchObject({ success: true });
      expect(eventTypes()).toContain("agent_settled");
      expect(cluster.requests[0]?.signal?.aborted).toBe(true);
      const snapshot = await snapshotOf(host);
      expect(snapshot).toMatchObject({ messages: [], isStreaming: false });
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
    it.each([0, 1, 2, 4, 8])(
      "never leaves a prompt sent just before New chat running unseen (%i ticks apart)",
      async (ticks) => {
        cluster = standInCluster({ hang: ["/version"] });
        const host = createHost();
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
        if (snapshot.isStreaming) {
          expect(snapshot.messages[0]).toMatchObject({ role: "user" });
        }
      },
    );

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

    const scaleWeb = { kind: "Deployment", name: "web", namespace: "default", data: { spec: { replicas: 3 } } };
    const WEB_PATH = "/apis/apps/v1/namespaces/default/deployments/web";

    // The structured tools' requests; the kubectl calls have their own tests above.
    const uiRequests = () =>
      envelopes.flatMap((e) => (e.kind === "ui_request" && !isCliApprovalRequest(e.payload) ? [e.payload] : []));
    const uiResolved = () => envelopes.flatMap((e) => (e.kind === "ui_resolved" ? [e.payload] : []));
    // The requests that change the cluster: every one but the reads.
    const writes = () => cluster.requests.filter(({ method }) => method !== "get" && method !== "getResponse");
    // A model answer that waits until the test lets it go, so the test can act between two tool calls.
    const heldUntil = (gate: Promise<void>, message: ReturnType<typeof fauxAssistantMessage>) => async () => {
      await gate;
      return message;
    };

    it("asks before a mutating call and runs it in main once approved", async () => {
      faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
      const host = createHost({ tools: gatedTools });

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
      expect(writes()).toEqual([]);
      expect((await snapshotOf(host)).pendingUiRequest).toEqual(request);

      const response = await host.handleCommand("c1", { type: "ui_response", id: request.id, confirmed: true });
      expect(response).toMatchObject({ success: true });
      await waitFor(settled);

      expect(uiResolved()).toEqual([{ id: request.id, confirmed: true }]);
      expect(writes()).toEqual([
        expect.objectContaining({ method: "patch", path: WEB_PATH, data: { spec: { replicas: 3 } } }),
      ]);
      expect(answerText()).toBe('Result: Deployment "web" patched successfully');
      expect((await snapshotOf(host)).pendingUiRequest).toBeUndefined();
      expect(envelopes.every((e) => ENVELOPE_KINDS.includes(e.kind))).toBe(true);
    });

    it("blocks a denied call and sends no request", async () => {
      faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
      const host = createHost({ tools: gatedTools });

      await host.handleCommand("c1", { type: "prompt", message: "scale web to 3" });
      await waitFor(() => uiRequests().length > 0);
      await host.handleCommand("c1", { type: "ui_response", id: uiRequests()[0]!.id, confirmed: false });
      await waitFor(settled);

      expect(writes()).toEqual([]);
      expect(uiResolved()).toEqual([{ id: uiRequests()[0]!.id, confirmed: false }]);
      expect(answerText()).toBe("Result: The user denied the action");
    });

    it("rejects an invalid manifest with its validation error and never asks", async () => {
      faux.setResponses(callThenEcho("createKubernetesResource", { kind: "Pod", data: { metadata: { name: "p" } } }));
      const host = createHost({ tools: gatedTools });

      await host.handleCommand("c1", { type: "prompt", message: "create a pod" });
      await waitFor(settled);

      expect(uiRequests()).toEqual([]);
      expect(cluster.requests).toEqual([]);
      expect(answerText()).toMatch(/^Result: The Pod manifest is invalid: /);
    });

    it("sends the prepared manifest the user approved", async () => {
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
      const host = createHost({ tools: gatedTools });

      await host.handleCommand("c1", { type: "prompt", message: "create a service" });
      await waitFor(() => uiRequests().length > 0);
      const request = uiRequests()[0]!;
      expect(request).toMatchObject({
        title: "CREATE SERVICE",
        approval: { kind: "Service", apiVersion: "v1", name: "svc", namespace: "shop" },
      });
      await host.handleCommand("c1", { type: "ui_response", id: request.id, confirmed: true });
      await waitFor(settled);

      expect(writes()).toEqual([
        expect.objectContaining({
          method: "post",
          path: "/api/v1/namespaces/shop/services",
          data: {
            apiVersion: "v1",
            kind: "Service",
            metadata: { name: "svc", namespace: "shop" },
            spec: { ports: [{ port: 80, targetPort: 8080 }] },
          },
        }),
      ]);
      expect(request.message).toContain("apiVersion: v1");
      expect(request.message).not.toContain("v9");
      expect(answerText()).toBe('Result: Service "svc" created successfully');
    });

    it("denies a pending approval on Stop, ends the run and sends no request", async () => {
      faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
      const host = createHost({ tools: gatedTools });

      await host.handleCommand("c1", { type: "prompt", message: "scale web to 3" });
      await waitFor(() => uiRequests().length > 0);

      expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });
      await waitFor(settled);

      expect(uiResolved()).toEqual([{ id: uiRequests()[0]!.id, confirmed: false }]);
      expect(writes()).toEqual([]);
      const snapshot = await snapshotOf(host);
      expect(snapshot.isStreaming).toBe(false);
      expect(snapshot.pendingUiRequest).toBeUndefined();
    });

    describe("the backup on the approval card", () => {
      const restartWebArgs = { kind: "Deployment", name: "web", namespace: "default" };
      const webManifest = {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "web", namespace: "default" },
        spec: {
          replicas: 3,
          selector: { matchLabels: { app: "web" } },
          template: {
            metadata: { labels: { app: "web" } },
            spec: { containers: [{ name: "web", image: "nginx:1.27", ports: [{ containerPort: 80 }] }] },
          },
        },
      };
      const WEB_YAML = [
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        "  name: web",
        "  namespace: default",
        "spec:",
        "  replicas: 2",
        "status:",
        "  readyReplicas: 2",
        "",
      ].join("\n");
      const WEB_1_YAML = [
        "apiVersion: v1",
        "kind: Pod",
        "metadata:",
        "  name: web-1",
        "  namespace: default",
        "spec:",
        "  containers:",
        "    - name: app",
        "",
      ].join("\n");

      it.each<{ tool: AgentToolDefinition; args: Parameters<typeof fauxToolCall>[1]; yaml: string }>([
        { tool: updateKubernetesResourceTool, args: { ...restartWebArgs, data: webManifest }, yaml: WEB_YAML },
        { tool: patchKubernetesResourceTool, args: scaleWeb, yaml: WEB_YAML },
        { tool: deleteKubernetesResourceTool, args: restartWebArgs, yaml: WEB_YAML },
        { tool: deletePodTool, args: { name: "web-1", namespace: "default", mode: "evict" }, yaml: WEB_1_YAML },
        { tool: restartKubernetesResourceTool, args: restartWebArgs, yaml: WEB_YAML },
      ])("puts the current object's YAML on the approval request of $tool.name", async ({ tool, args, yaml }) => {
        faux.setResponses(callThenEcho(tool.name, args));
        const host = createHost({ tools: [tool] });

        await host.handleCommand("c1", { type: "prompt", message: "change it" });
        await waitFor(() => uiRequests().length > 0);

        expect(uiRequests()[0]?.backup).toBe(yaml);
        expect(writes()).toEqual([]);
      });

      it("loads none for a create, which changes no existing object", async () => {
        faux.setResponses(
          callThenEcho("createKubernetesResource", { kind: "Namespace", apiVersion: "v1", name: "team", data: {} }),
        );
        const host = createHost({ tools: gatedTools });

        await host.handleCommand("c1", { type: "prompt", message: "create a namespace" });
        await waitFor(() => uiRequests().length > 0);

        expect(uiRequests()[0]).not.toHaveProperty("backup");
        expect(cluster.requests).toEqual([]);
      });

      it("leaves it out when the object cannot be loaded, without blocking the approval", async () => {
        faux.setResponses(callThenEcho("patchKubernetesResource", { ...scaleWeb, name: "gone" }));
        const host = createHost({ tools: gatedTools });

        await host.handleCommand("c1", { type: "prompt", message: "scale gone to 3" });
        await waitFor(() => uiRequests().length > 0);
        const request = uiRequests()[0]!;
        expect(request).not.toHaveProperty("backup");
        expect(request.title).toBe("PATCH DEPLOYMENT");

        await host.handleCommand("c1", { type: "ui_response", id: request.id, confirmed: true });
        await waitFor(settled);
        expect(writes()).toEqual([
          expect.objectContaining({ method: "patch", path: "/apis/apps/v1/namespaces/default/deployments/gone" }),
        ]);
      });

      it("is cancelled by Stop while it loads, and nothing is asked or sent", async () => {
        cluster = standInCluster({ hang: [WEB_PATH] });
        faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
        const host = createHost({ tools: gatedTools });

        await host.handleCommand("c1", { type: "prompt", message: "scale web to 3" });
        await waitFor(() => cluster.requests.some(({ path }) => path === WEB_PATH));
        expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });
        await waitFor(settled);

        expect(cluster.requests.find(({ path }) => path === WEB_PATH)?.signal?.aborted).toBe(true);
        expect(uiRequests()).toEqual([]);
        expect(writes()).toEqual([]);
      });

      it("loads none from a cluster that is not connected, and the approved call answers 'Cluster not connected'", async () => {
        faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
        let clients = 0;
        const host = createHost({
          tools: gatedTools,
          getClusterApi: () => {
            clients += 1;
            return cluster.api;
          },
        });

        await host.handleCommand("gone", { type: "prompt", message: "scale web to 3" });
        await waitFor(() => uiRequests().length > 0);
        expect(uiRequests()[0]).not.toHaveProperty("backup");
        await host.handleCommand("gone", { type: "ui_response", id: uiRequests()[0]!.id, confirmed: true });
        await waitFor(settled);

        expect(clients).toBe(0);
        expect(cluster.requests).toEqual([]);
        expect(answerText()).toBe("Result: Cluster not connected");
      });
    });

    describe("per-tool approval settings", () => {
      const restartWeb = { kind: "Deployment", name: "web", namespace: "default" };

      it("runs a default-gated tool without a card once its approval is turned off", async () => {
        faux.setResponses(callThenEcho("restartKubernetesResource", restartWeb));
        const host = createHost({
          tools: [...gatedTools, restartKubernetesResourceTool],
          getApprovalOverrides: () => ({ restartKubernetesResource: false }),
        });

        await host.handleCommand("c1", { type: "prompt", message: "restart web" });
        await waitFor(settled);

        expect(uiRequests()).toEqual([]);
        expect(writes()).toEqual([expect.objectContaining({ method: "patch", path: WEB_PATH })]);
        expect(answerText()).toBe('Result: Deployment "web" restarted successfully');
      });

      // The write tools apply their input as it comes, so the gate still
      // validates and prepares it when nobody is asked.
      it("still rejects an invalid manifest once a write tool's approval is turned off", async () => {
        faux.setResponses(callThenEcho("createKubernetesResource", { kind: "Pod", data: { metadata: { name: "p" } } }));
        const host = createHost({
          tools: gatedTools,
          getApprovalOverrides: () => ({ createKubernetesResource: false }),
        });

        await host.handleCommand("c1", { type: "prompt", message: "create a pod" });
        await waitFor(settled);

        expect(uiRequests()).toEqual([]);
        expect(cluster.requests).toEqual([]);
        expect(answerText()).toMatch(/^Result: The Pod manifest is invalid: /);
      });

      it("still sends the prepared input once a write tool's approval is turned off", async () => {
        faux.setResponses(
          callThenEcho("patchKubernetesResource", {
            ...scaleWeb,
            subresource: "/scale/",
            data: { spec: { replicas: 2 } },
          }),
        );
        const host = createHost({
          tools: gatedTools,
          getApprovalOverrides: () => ({ patchKubernetesResource: false }),
        });

        await host.handleCommand("c1", { type: "prompt", message: "scale web to 2" });
        await waitFor(settled);

        expect(uiRequests()).toEqual([]);
        expect(writes()).toEqual([expect.objectContaining({ method: "patch", path: `${WEB_PATH}/scale` })]);
      });

      it("asks before a read tool once its approval is turned on", async () => {
        faux.setResponses(callThenEcho("getClusterVersion", {}));
        const host = createHost({
          tools: gatedTools,
          getApprovalOverrides: () => ({ getClusterVersion: true }),
        });

        await host.handleCommand("c1", { type: "prompt", message: "which version?" });
        await waitFor(() => uiRequests().length > 0);

        expect(uiRequests()[0]).toMatchObject({ method: "confirm", approval: { tool: "getClusterVersion" } });
        expect(uiRequests()[0]).not.toHaveProperty("backup");
        expect(cluster.requests).toEqual([]);
      });

      it("reads the setting at each call, so a change applies to the next call", async () => {
        let overrides: Record<string, boolean> = { patchKubernetesResource: false };
        let nextCall!: () => void;
        const secondCall = new Promise<void>((resolve) => {
          nextCall = resolve;
        });
        faux.setResponses([
          fauxAssistantMessage([fauxToolCall("patchKubernetesResource", scaleWeb)], { stopReason: "toolUse" }),
          heldUntil(
            secondCall,
            fauxAssistantMessage([fauxToolCall("patchKubernetesResource", { ...scaleWeb, name: "api" })], {
              stopReason: "toolUse",
            }),
          ),
          fauxAssistantMessage([fauxText("done")]),
        ]);
        const host = createHost({ tools: gatedTools, getApprovalOverrides: () => overrides });

        await host.handleCommand("c1", { type: "prompt", message: "scale web and api" });
        await waitFor(() => writes().length > 0);
        expect(uiRequests()).toEqual([]);

        overrides = {};
        nextCall();
        await waitFor(() => uiRequests().length > 0);
        expect(uiRequests()[0]).toMatchObject({ approval: { tool: "patchKubernetesResource", name: "api" } });
        expect(writes()).toHaveLength(1);
      });

      it("runs pod logs without a card for a saved podLogsRequireApproval: false", async () => {
        faux.setResponses(callThenEcho("getPodLogs", { name: "web-1", namespace: "default" }));
        const imported = loadApprovalOverrides({ podLogsRequireApproval: false });
        const host = createHost({ tools: gatedTools, getApprovalOverrides: () => imported });

        await host.handleCommand("c1", { type: "prompt", message: "show the logs" });
        await waitFor(settled);

        expect(imported).toEqual({ getPodLogs: false });
        expect(uiRequests()).toEqual([]);
        expect(answerText()).toBe("Result: started\n");
      });

      it("asks for pod logs by default, without loading a backup", async () => {
        faux.setResponses(callThenEcho("getPodLogs", { name: "web-1", namespace: "default" }));
        const host = createHost({ tools: gatedTools, getApprovalOverrides: () => loadApprovalOverrides({}) });

        await host.handleCommand("c1", { type: "prompt", message: "show the logs" });
        await waitFor(() => uiRequests().length > 0);

        expect(uiRequests()[0]).toMatchObject({ title: "READ LOGS POD" });
        expect(uiRequests()[0]).not.toHaveProperty("backup");
        expect(cluster.requests).toEqual([]);
      });

      // Pod logs, restart and delete pod are approved with their input unchanged.
      it("runs an approved call with its arguments when they need no preparation", async () => {
        faux.setResponses(callThenEcho("deletePod", { name: "web-1", namespace: "default", mode: "evict" }));
        const host = createHost({ tools: [...gatedTools, deletePodTool] });

        await host.handleCommand("c1", { type: "prompt", message: "evict web-1" });
        await waitFor(() => uiRequests().length > 0);
        await host.handleCommand("c1", { type: "ui_response", id: uiRequests()[0]!.id, confirmed: true });
        await waitFor(settled);

        expect(writes()).toEqual([
          expect.objectContaining({ method: "post", path: "/api/v1/namespaces/default/pods/web-1/eviction" }),
        ]);
        expect(answerText()).toBe('Result: Pod "web-1" evicted successfully');
      });

      it("runs an approved read in main with the arguments the user approved", async () => {
        faux.setResponses(callThenEcho("getPodLogs", { name: "web-1", namespace: "default" }));
        const host = createHost({ tools: gatedTools });

        await host.handleCommand("c1", { type: "prompt", message: "show the logs" });
        await waitFor(() => uiRequests().length > 0);
        expect(cluster.requests).toEqual([]);
        await host.handleCommand("c1", { type: "ui_response", id: uiRequests()[0]!.id, confirmed: true });
        await waitFor(settled);

        expect(cluster.actions()).toEqual([
          expect.objectContaining({ method: "get", path: "/api/v1/namespaces/default/pods/web-1" }),
          expect.objectContaining({ method: "getResponse", path: "/api/v1/namespaces/default/pods/web-1/log" }),
        ]);
        expect(answerText()).toBe("Result: started\n");
      });
    });

    it("rejects a ui_response for an unknown request", async () => {
      const host = createHost();
      const response = await host.handleCommand("c1", { type: "ui_response", id: "nope", confirmed: true });
      expect(response).toMatchObject({ success: false });
    });

    describe("approve all in this chat", () => {
      const autoApproveChanges = () => envelopes.flatMap((e) => (e.kind === "auto_approve" ? [e.payload] : []));
      const scaleApi = { ...scaleWeb, name: "api" };
      const patchedNames = () => writes().map(({ path }) => path.split("/").at(-1));
      // Two changes in one run, the second after the first one's result. The
      // second call waits for `secondCall` when one is given.
      const twoPatches = (secondCall: Promise<void> = Promise.resolve()) => [
        fauxAssistantMessage([fauxToolCall("patchKubernetesResource", scaleWeb)], { stopReason: "toolUse" }),
        heldUntil(
          secondCall,
          fauxAssistantMessage([fauxToolCall("patchKubernetesResource", scaleApi)], { stopReason: "toolUse" }),
        ),
        fauxAssistantMessage([fauxText("both scaled")]),
      ];
      const approveAll = (host: AgentHost, clusterId = "c1") =>
        host.handleCommand(clusterId, {
          type: "ui_response",
          id: uiRequests()[uiRequests().length - 1]!.id,
          confirmed: true,
          approveAll: true,
        });

      it("approves the pending call and runs the next gated call without asking", async () => {
        faux.setResponses(twoPatches());
        const host = createHost({ tools: gatedTools });

        await host.handleCommand("c1", { type: "prompt", message: "scale web and api" });
        await waitFor(() => uiRequests().length > 0);
        const request = uiRequests()[0]!;
        expect(await approveAll(host)).toMatchObject({ success: true });
        expect(autoApproveChanges()).toEqual([{ enabled: true }]);
        await waitFor(settled);

        expect((await snapshotOf(host)).autoApprove).toBe(true);
        expect(uiRequests()).toEqual([request]);
        expect(uiResolved()).toEqual([{ id: request.id, confirmed: true }]);
        expect(patchedNames()).toEqual(["web", "api"]);
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
        expect(writes()).toEqual([]);
      });

      it("still blocks an invalid manifest while approving all", async () => {
        faux.setResponses([
          fauxAssistantMessage([fauxToolCall("patchKubernetesResource", scaleWeb)], { stopReason: "toolUse" }),
          ...callThenEcho("createKubernetesResource", { kind: "Pod", data: { metadata: { name: "p" } } }),
        ]);
        const host = createHost({ tools: gatedTools });

        await host.handleCommand("c1", { type: "prompt", message: "scale web, then create a pod" });
        await waitFor(() => uiRequests().length > 0);
        await approveAll(host);
        await waitFor(settled);

        expect(uiRequests()).toHaveLength(1);
        expect(patchedNames()).toEqual(["web"]);
        expect(answerText()).toMatch(/Result: The Pod manifest is invalid: /);
      });

      it("asks again once it is turned off", async () => {
        let nextCall!: () => void;
        faux.setResponses(
          twoPatches(
            new Promise<void>((resolve) => {
              nextCall = resolve;
            }),
          ),
        );
        const host = createHost({ tools: gatedTools });

        await host.handleCommand("c1", { type: "prompt", message: "scale web and api" });
        await waitFor(() => uiRequests().length > 0);
        await approveAll(host);

        const response = await host.handleCommand("c1", { type: "set_auto_approve", enabled: false });
        expect(response).toMatchObject({ command: "set_auto_approve", success: true });
        expect(autoApproveChanges()).toEqual([{ enabled: true }, { enabled: false }]);
        expect((await snapshotOf(host)).autoApprove).toBe(false);

        nextCall();
        await waitFor(() => uiRequests().length > 1);
        expect(uiRequests()[1]).toMatchObject({ approval: { name: "api" } });
        expect(patchedNames()).toEqual(["web"]);
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
        const host = createHost({ tools: gatedTools });
        await host.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(() => uiRequests().length > 0);
        await approveAll(host);
        await waitFor(settled);

        const response = await host.handleCommand("c1", { type });
        expect(response.success && (response.data as AgentSnapshot).autoApprove).toBe(false);

        faux.setResponses(callThenEcho("patchKubernetesResource", scaleApi));
        await host.handleCommand("c1", { type: "prompt", message: "scale api" });
        await waitFor(() => uiRequests().length > 1);
        expect(patchedNames()).toEqual(["web"]);
      });

      it("is cleared by a restart", async () => {
        faux.setResponses(callThenEcho("patchKubernetesResource", scaleWeb));
        const first = createHost({ tools: gatedTools });
        await first.handleCommand("c1", { type: "prompt", message: "scale web" });
        await waitFor(() => uiRequests().length > 0);
        await approveAll(first);
        await waitFor(settled);
        first.dispose();

        const restarted = createHost({ tools: gatedTools });
        expect((await snapshotOf(restarted)).autoApprove).toBe(false);
      });
    });
  });

  describe("AI Explain", () => {
    interface SeenRequest {
      prompt: string;
      tools: string[];
      user: string;
    }

    // Records the system prompt, the tools and the last user message the model saw.
    const recordingResponse = (seen: SeenRequest[], text: string) => (context: Parameters<FauxFactory>[0]) => {
      const request: SeenRequest = { prompt: "", tools: [], user: "" };
      for (const message of context.messages) {
        if (message.role === "system") {
          const content =
            typeof message.content === "string" ? message.content : message.content.map((c) => c.text).join("");
          request.prompt += content + Object.values(message.sections ?? {}).join("");
          request.tools.push(...(message.toolsAdded ?? []).map((tool) => tool.name));
        }
        if (message.role === "user") {
          request.user =
            typeof message.content === "string"
              ? message.content
              : message.content.map((c) => (c.type === "text" ? c.text : "")).join("");
        }
      }
      seen.push(request);
      return fauxAssistantMessage([fauxText(text)]);
    };

    const explainSettled = (sessionId: string) =>
      envelopes.some((e) => e.sessionId === sessionId && e.kind === "event" && e.payload.type === "agent_settled");

    const sessionFiles = (clusterId: string) => {
      const dir = join(dataDir, "sessions", clusterId);
      return existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith(".jsonl")) : [];
    };

    it("streams the answer under its own session id and leaves the chat's session file unchanged", async () => {
      const seen: SeenRequest[] = [];
      faux.setResponses([fauxAssistantMessage([fauxText("Chat answer")]), recordingResponse(seen, "Explained.")]);
      const host = createHost();

      await host.handleCommand("c1", { type: "prompt", message: "hi" });
      await waitFor(settled);
      const chatSessionId = envelopes[0]!.sessionId;
      const [file] = sessionFiles("c1");
      const before = readFileSync(join(dataDir, "sessions", "c1", file!), "utf8");
      const chatCount = envelopes.length;

      const response = await host.handleCommand("c1", { type: "explain", message: "Pod web-1 is CrashLoopBackOff" });
      expect(response).toMatchObject({ command: "explain", success: true });
      const explainEnvelopes = () => envelopes.slice(chatCount);
      await waitFor(() => explainEnvelopes().length > 0);
      const explainSessionId = explainEnvelopes()[0]!.sessionId;
      expect(explainSessionId).not.toBe(chatSessionId);
      await waitFor(() => explainSettled(explainSessionId));

      expect(explainEnvelopes().every((e) => e.clusterId === "c1" && e.sessionId === explainSessionId)).toBe(true);
      // One seq per cluster, so the frame keeps chat and explain envelopes in order.
      expect(envelopes.map((e) => e.seq)).toEqual(envelopes.map((_, index) => index + 1));
      const text = explainEnvelopes()
        .flatMap((e) => (e.kind === "event" && e.payload.type === "message_update" ? [e.payload] : []))
        .map((p) => (p.assistantMessageEvent.type === "text_delta" ? p.assistantMessageEvent.delta : ""))
        .join("");
      expect(text).toBe("Explained.");
      expect(seen[0]?.user).toContain("Pod web-1 is CrashLoopBackOff");

      expect(sessionFiles("c1")).toEqual([file]);
      expect(readFileSync(join(dataDir, "sessions", "c1", file!), "utf8")).toBe(before);
      const snapshot = await snapshotOf(host);
      expect(snapshot.sessionId).toBe(chatSessionId);
      expect(snapshot.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    });

    it("writes no session file for a cluster that never chatted", async () => {
      faux.setResponses([fauxAssistantMessage([fauxText("Explained.")])]);
      const host = createHost();

      await host.handleCommand("c1", { type: "explain", message: "an event" });
      await waitFor(settled);

      expect(sessionFiles("c1")).toEqual([]);
      expect((await snapshotOf(host)).messages).toEqual([]);
    });

    it("uses the explain prompt with its five sections, no emoji and no tools", async () => {
      const seen: SeenRequest[] = [];
      faux.setResponses([recordingResponse(seen, "ok")]);
      const host = createHost({ tools: [getClusterVersionTool, patchKubernetesResourceTool] });

      await host.handleCommand("c1", { type: "explain", message: "an event" });
      await waitFor(settled);

      const prompt = seen[0]!.prompt;
      for (const heading of ["Summary", "Diagnosis", "Impact", "Recommended Actions", "Reference"]) {
        expect(prompt).toContain(`### ${heading}`);
      }
      expect(prompt).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(prompt).not.toContain("<user_rules>");
      expect(seen[0]!.tools).toEqual([]);
    });

    it("adds the user's custom agent rules to the explain prompt", async () => {
      const seen: SeenRequest[] = [];
      faux.setResponses([recordingResponse(seen, "ok")]);
      const host = createHost({ getUserRules: () => "Always answer in Italian." });

      await host.handleCommand("c1", { type: "explain", message: "an event" });
      await waitFor(settled);

      expect(seen[0]!.prompt).toContain("Always answer in Italian.");
    });

    it("is refused while a chat run is going", async () => {
      runThatHangs();
      const host = createHost();

      await host.handleCommand("c1", { type: "prompt", message: "which version?" });
      await waitFor(clusterAsked);

      const response = await host.handleCommand("c1", { type: "explain", message: "an event" });
      expect(response).toMatchObject({ command: "explain", success: false });
    });

    it("refuses a second explanation sent at the same time", async () => {
      faux.setResponses([fauxAssistantMessage([fauxText("one")]), fauxAssistantMessage([fauxText("two")])]);
      const host = createHost();

      const responses = await Promise.all([
        host.handleCommand("c1", { type: "explain", message: "first" }),
        host.handleCommand("c1", { type: "explain", message: "second" }),
      ]);
      await waitFor(settled);

      expect(responses.filter((response) => response.success)).toHaveLength(1);
      expect(eventTypes().filter((type) => type === "agent_start")).toHaveLength(1);
    });

    it("is stopped by a Stop sent before pi starts it", async () => {
      faux.setResponses([fauxAssistantMessage([fauxText("Should not appear")])]);
      const host = createHost();

      const explained = host.handleCommand("c1", { type: "explain", message: "an event" });
      expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });
      await explained;
      await new Promise((resolve) => setTimeout(resolve, 50));

      const text = envelopes
        .flatMap((e) => (e.kind === "event" && e.payload.type === "message_update" ? [e.payload] : []))
        .map((p) => (p.assistantMessageEvent.type === "text_delta" ? p.assistantMessageEvent.delta : ""))
        .join("");
      expect(text).toBe("");
      expect((await snapshotOf(host)).isStreaming).toBe(false);
      expect(await host.handleCommand("c1", { type: "explain", message: "again" })).toMatchObject({ success: true });
    });

    it("is refused when no model is selected", async () => {
      const host = createHost({ getModelRef: () => undefined });
      const response = await host.handleCommand("c1", { type: "explain", message: "an event" });
      expect(response).toMatchObject({ command: "explain", success: false });
      expect(envelopes).toEqual([]);
    });

    describe("while an explanation is streaming", () => {
      let release: (() => void) | undefined;

      // An answer that waits until the test releases it or the run is aborted.
      const heldResponse: FauxFactory = (_context, options) =>
        new Promise((resolve) => {
          release = () => resolve(fauxAssistantMessage([fauxText("late")]));
          options?.signal?.addEventListener("abort", () =>
            resolve(fauxAssistantMessage([fauxText("")], { stopReason: "aborted" })),
          );
        });

      beforeEach(() => {
        release = undefined;
      });

      it("refuses a chat prompt and a second explanation, and reports the run in the snapshot", async () => {
        faux.setResponses([heldResponse]);
        const host = createHost();

        await host.handleCommand("c1", { type: "explain", message: "an event" });
        await waitFor(() => release !== undefined);

        expect(await host.handleCommand("c1", { type: "prompt", message: "hi" })).toMatchObject({ success: false });
        expect(await host.handleCommand("c1", { type: "explain", message: "again" })).toMatchObject({
          success: false,
        });
        const snapshot = await snapshotOf(host);
        expect(snapshot.isStreaming).toBe(true);
        expect(snapshot.streamingMessage).toBeUndefined();

        release!();
        await waitFor(settled);
        expect((await snapshotOf(host)).isStreaming).toBe(false);
      });

      it("is stopped by Stop", async () => {
        faux.setResponses([heldResponse]);
        const host = createHost();

        await host.handleCommand("c1", { type: "explain", message: "an event" });
        await waitFor(() => release !== undefined);

        expect(await host.handleCommand("c1", { type: "abort" })).toMatchObject({ success: true });
        await waitFor(settled);
        const end = envelopes.find(
          (e) => e.kind === "event" && e.payload.type === "message_end" && e.payload.message.role === "assistant",
        );
        expect(end).toMatchObject({ payload: { message: { stopReason: "aborted" } } });
      });
    });
  });

  describe("session stats", () => {
    const statsEnvelopes = (clusterId = "c1") =>
      envelopes.flatMap((e) => (e.kind === "stats" && e.clusterId === clusterId ? [e] : []));

    it("broadcasts stats with the answer's tokens after it is saved and when the run settles", async () => {
      faux.setResponses([fauxAssistantMessage([fauxText("Two hundred pods are running.")])]);
      const host = createHost();

      await host.handleCommand("c1", { type: "prompt", message: "how many pods?" });
      await waitFor(settled);

      const stats = statsEnvelopes();
      // One after the assistant message is saved, one at agent_settled.
      expect(stats.length).toBe(2);
      const last = stats[stats.length - 1]!;
      expect(last.sessionId).toBe(envelopes[0]!.sessionId);
      expect(last.payload.assistantMessages).toBe(1);
      expect(last.payload.tokens.output).toBeGreaterThan(0);
      expect(last.payload.tokens.total).toBeGreaterThan(0);
      // The assistant message's stats already count it, though they go out before agent_settled.
      expect(stats[0]!.payload.tokens).toEqual(last.payload.tokens);
      const settledSeq = envelopes.find((e) => e.kind === "event" && e.payload.type === "agent_settled")!.seq;
      expect(stats[0]!.seq).toBeLessThan(settledSeq);
      expect(last.seq).toBeGreaterThan(settledSeq);
    });

    it("fills the context gauge from the model's context window", async () => {
      faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
      const host = createHost();

      await host.handleCommand("c1", { type: "prompt", message: "hi" });
      await waitFor(settled);

      const last = statsEnvelopes().at(-1)!;
      expect(last.payload.contextUsage).toMatchObject({ contextWindow: faux.getModel().contextWindow });
      expect(last.payload.contextUsage?.tokens).toBeGreaterThan(0);
    });

    it("adds up the tokens of every turn of a run with tool calls", async () => {
      faux.setResponses(callThenEcho("getClusterVersion", {}));
      const host = createHost();

      await host.handleCommand("c1", { type: "prompt", message: "which version?" });
      await waitFor(settled);

      const stats = statsEnvelopes();
      expect(stats.map((s) => s.payload.assistantMessages)).toEqual([1, 2, 2]);
      expect(stats[1]!.payload.tokens.total).toBeGreaterThan(stats[0]!.payload.tokens.total);
    });

    it("answers get_session_stats and includes the stats in the snapshot", async () => {
      faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
      const host = createHost();

      await host.handleCommand("c1", { type: "prompt", message: "hi" });
      await waitFor(settled);

      const last = statsEnvelopes().at(-1)!.payload;
      const response = await host.handleCommand("c1", { type: "get_session_stats" });
      expect(response).toMatchObject({ command: "get_session_stats", success: true, data: last });
      expect((await snapshotOf(host)).stats).toEqual(last);
    });

    it("has no stats for a cluster that never chatted, and creates no files for it", async () => {
      const host = createHost();

      expect(await host.handleCommand("fresh", { type: "get_session_stats" })).toMatchObject({
        success: true,
        data: undefined,
      });
      expect((await snapshotOf(host, "fresh")).stats).toBeUndefined();
      expect(existsSync(join(dataDir, "sessions", "fresh"))).toBe(false);
    });

    describe("after pi compacts the chat", () => {
      // A small context window and compaction settings that make pi compact
      // after the second, large prompt.
      const compactingHost = () => {
        faux = fauxProvider({
          tokensPerSecond: 100_000,
          models: [{ id: "tiny", contextWindow: 4000 }],
        });
        modelRuntime.registerNativeProvider(faux.provider);
        faux.setResponses([
          fauxAssistantMessage([fauxText("first answer")]),
          fauxAssistantMessage([fauxText("second answer")]),
          ...Array.from({ length: 4 }, () => fauxAssistantMessage([fauxText("Summary of the chat.")])),
        ]);
        return createHost({ compaction: { reserveTokens: 1000, keepRecentTokens: 100 } });
      };
      const compactionEnded = () => eventTypes().includes("compaction_end");

      it("keeps the whole transcript in the snapshot, with a compaction marker", async () => {
        const host = compactingHost();

        await host.handleCommand("c1", { type: "prompt", message: "hi" });
        await waitFor(settled);
        envelopes = [];
        await host.handleCommand("c1", { type: "prompt", message: "x".repeat(14_000) });
        await waitFor(compactionEnded);
        await waitFor(settled);

        expect(envelopes.find((e) => e.kind === "event" && e.payload.type === "compaction_end")).toMatchObject({
          payload: { aborted: false },
        });
        const snapshot = await snapshotOf(host);
        expect(snapshot.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "compaction"]);
      });

      it("sends stats after the compaction, with the context size unknown until the next answer", async () => {
        const host = compactingHost();

        await host.handleCommand("c1", { type: "prompt", message: "hi" });
        await waitFor(settled);
        await host.handleCommand("c1", { type: "prompt", message: "x".repeat(14_000) });
        await waitFor(compactionEnded);
        await waitFor(() => {
          const end = envelopes.findIndex((e) => e.kind === "event" && e.payload.type === "compaction_end");
          return envelopes.slice(end).some((e) => e.kind === "stats");
        });

        const last = statsEnvelopes().at(-1)!.payload;
        // pi does not know the context size until the next answer after a compaction.
        expect(last.contextUsage).toMatchObject({ tokens: null, contextWindow: 4000 });
      });
    });

    it("sends no stats for an explanation, which is not part of the chat", async () => {
      faux.setResponses([fauxAssistantMessage([fauxText("Explained.")])]);
      const host = createHost();

      await host.handleCommand("c1", { type: "explain", message: "an event" });
      await waitFor(settled);

      expect(statsEnvelopes()).toEqual([]);
    });
  });

  describe("model requests through the injected fetch", () => {
    const hostFetch: typeof fetch = async () => new Response(null, { status: 500 });

    // Answers with the fetch the provider request carried, so a test reads it from the chat.
    const reportFetch: FauxFactory = (_context, options) =>
      fauxAssistantMessage([fauxText(options?.fetch === hostFetch ? "host fetch" : "default fetch")]);

    const answerText = () =>
      envelopes
        .flatMap((e) => (e.kind === "event" && e.payload.type === "message_update" ? [e.payload] : []))
        .map((p) => (p.assistantMessageEvent.type === "text_delta" ? p.assistantMessageEvent.delta : ""))
        .join("");

    it("passes the injected fetch to the provider request of a chat run", async () => {
      faux.setResponses([reportFetch]);
      const host = createHost({ fetch: hostFetch });

      await host.handleCommand("c1", { type: "prompt", message: "hi" });
      await waitFor(settled);

      expect(answerText()).toBe("host fetch");
    });

    it("passes the injected fetch to the provider request of an explanation", async () => {
      faux.setResponses([reportFetch]);
      const host = createHost({ fetch: hostFetch });

      await host.handleCommand("c1", { type: "explain", message: "an event" });
      await waitFor(settled);

      expect(answerText()).toBe("host fetch");
    });

    it("passes the injected fetch to the summary requests of a compaction", async () => {
      faux = fauxProvider({ tokensPerSecond: 100_000, models: [{ id: "tiny", contextWindow: 4000 }] });
      modelRuntime.registerNativeProvider(faux.provider);
      const fetches: (typeof fetch | undefined)[] = [];
      const recordFetch =
        (text: string): FauxFactory =>
        (_context, options) => {
          fetches.push(options?.fetch);
          return fauxAssistantMessage([fauxText(text)]);
        };
      faux.setResponses([
        recordFetch("first answer"),
        recordFetch("second answer"),
        ...Array.from({ length: 4 }, () => recordFetch("Summary of the chat.")),
      ]);
      const host = createHost({ fetch: hostFetch, compaction: { reserveTokens: 1000, keepRecentTokens: 100 } });

      await host.handleCommand("c1", { type: "prompt", message: "hi" });
      await waitFor(settled);
      await host.handleCommand("c1", { type: "prompt", message: "x".repeat(14_000) });
      await waitFor(() => eventTypes().includes("compaction_end"));

      // The two answers and at least one summary.
      expect(fetches.length).toBeGreaterThan(2);
      expect(fetches.every((used) => used === hostFetch)).toBe(true);
    });

    // pi's adapters for these APIs throw "Custom fetch is not supported".
    const googleApis = ["google-generative-ai", "google-vertex"];

    it.each(googleApis)("keeps pi's default fetch for a model on the %s API", async (api) => {
      faux = fauxProvider({ api, provider: `faux-${api}`, tokensPerSecond: 100_000 });
      modelRuntime.registerNativeProvider(faux.provider);
      faux.setResponses([reportFetch, reportFetch]);
      const host = createHost({ fetch: hostFetch });

      await host.handleCommand("c1", { type: "prompt", message: "hi" });
      await waitFor(settled);
      expect(answerText()).toBe("default fetch");

      envelopes = [];
      await host.handleCommand("c1", { type: "explain", message: "an event" });
      await waitFor(settled);
      expect(answerText()).toBe("default fetch");
    });
  });
});
