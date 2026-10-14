// Spike for ticket 06: can pi-coding-agent run in the Freelens extension main
// process? Built with the same CJS rolldown settings as `src/main` (see
// `electron.vite.spike.config.mjs`) and run with plain Node/Electron.
//
// Uses pi-ai's faux provider so it runs without an API key. Set
// PI_SPIKE_OPENAI=1 with OPENAI_API_KEY to stream one real completion instead.

import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const clusterVersion = defineTool({
  name: "cluster_version",
  label: "Cluster version",
  description: "Returns the Kubernetes version of the current cluster.",
  parameters: Type.Object({}),
  async execute() {
    return { content: [{ type: "text", text: "v1.31.2" }], details: undefined };
  },
});

const deletePod = defineTool({
  name: "delete_pod",
  label: "Delete pod",
  description: "Deletes a pod. Requires user approval.",
  parameters: Type.Object({ namespace: Type.String(), name: Type.String() }),
  async execute(_id, params) {
    return { content: [{ type: "text", text: `deleted ${params.namespace}/${params.name}` }], details: undefined };
  },
});

// Starts pi's OAuth login for a provider and stops at the first URL or device
// code it emits, to check the flow modules load from the CJS bundle.
// PI_SPIKE_LOGIN=<provider>; PI_SPIKE_BUNDLED_OAUTH=1 registers the statically
// imported flows instead of pi's variable-specifier `import()`.
export async function runLoginSpike(providerId: string): Promise<void> {
  if (process.env.PI_SPIKE_BUNDLED_OAUTH === "1") registerBunOAuthFlows();
  const dir = mkdtempSync(join(tmpdir(), "pi-spike-login-"));
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: join(dir, "models.json"),
  });
  const controller = new AbortController();
  const seen: unknown[] = [];
  try {
    await modelRuntime.login(providerId, "oauth", {
      signal: controller.signal,
      prompt: async (prompt) => {
        seen.push({ prompt: prompt.type, message: prompt.message });
        controller.abort();
        throw new Error("spike: cancelled at prompt");
      },
      notify: (event) => {
        seen.push(event);
        if (event.type === "auth_url" || event.type === "device_code") controller.abort();
      },
    });
  } catch (error) {
    seen.push({ ended: String(error) });
  }
  console.log(JSON.stringify({ provider: providerId, seen }, null, 2));
}

export async function runPiSpike(): Promise<void> {
  const real = process.env.PI_SPIKE_OPENAI === "1";
  const dir = mkdtempSync(join(tmpdir(), "pi-spike-"));
  const agentDir = join(dir, "agent");
  const sessionDir = join(dir, "sessions");

  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });

  const faux = fauxProvider({ tokensPerSecond: 2000 });
  modelRuntime.registerNativeProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("cluster_version", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("delete_pod", { namespace: "default", name: "web-1" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("The cluster runs v1.31.2. I did not delete web-1: the user denied it.")]),
  ]);

  const model = real ? modelRuntime.getModel("openai", "gpt-5.4-mini") : faux.getModel();
  if (!model) throw new Error("model not found");
  if (real && process.env.OPENAI_API_KEY) await modelRuntime.setRuntimeApiKey("openai", process.env.OPENAI_API_KEY);

  const approvals: string[] = [];
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir,
    // Only our inline extension: no discovery of ~/.pi or project extensions.
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "You are the Freelens AI assistant. Use the tools to inspect the cluster.",
    extensionFactories: [
      (pi) => {
        pi.registerTool(clusterVersion);
        pi.registerTool(deletePod);
        // Approval gate: stands in for an IPC round-trip to the renderer UI.
        pi.on("tool_call", async (event) => {
          if (event.toolName !== "delete_pod") return undefined;
          approvals.push(JSON.stringify(event.input));
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { block: true, reason: "Denied by the user" };
        });
      },
    ],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: dir,
    agentDir,
    model,
    thinkingLevel: "off",
    modelRuntime,
    resourceLoader,
    noTools: "builtin",
    sessionManager: SessionManager.create(dir, sessionDir),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
  });

  const events: string[] = [];
  let text = "";
  let error: string | undefined;
  session.subscribe((event) => {
    events.push(event.type);
    if (event.type === "message_end" && event.message.role === "assistant" && event.message.errorMessage) {
      error = event.message.errorMessage;
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      text += event.assistantMessageEvent.delta;
    }
  });

  try {
    await session.prompt(real ? "Say hello in one short sentence." : "What version is my cluster? Then delete web-1.");
  } finally {
    session.dispose();
  }

  const files = readdirSync(sessionDir, { recursive: true }).map(String);
  const jsonl = files.find((f) => f.endsWith(".jsonl"));
  const entries = jsonl ? readFileSync(join(sessionDir, jsonl), "utf8").trim().split("\n").length : 0;
  const counts: Record<string, number> = {};
  for (const e of events) counts[e] = (counts[e] ?? 0) + 1;

  console.log(
    JSON.stringify(
      {
        node: process.version,
        electron: process.versions.electron ?? null,
        model: `${model.provider}/${model.id}`,
        text,
        error: error ?? null,
        approvals,
        events: counts,
        sessionFile: jsonl ?? null,
        sessionEntries: entries,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  const login = process.env.PI_SPIKE_LOGIN;
  (login ? runLoginSpike(login) : runPiSpike()).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
