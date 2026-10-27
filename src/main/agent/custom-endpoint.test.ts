import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeKubeJsonApi } from "../../../test/kube-json-api";
import { getClusterVersionTool } from "../../common/agent-tools";
import { AgentHost } from "./agent-host";
import { addCustomProvider } from "./custom-providers";
import type { AddressInfo } from "node:net";

import type { AgentEnvelope } from "../../common/agent-protocol";

interface SeenRequest {
  url?: string;
  headers: IncomingHttpHeaders;
  body: { model?: string };
}

// A minimal OpenAI-compatible server: answers every chat completion with one streamed text.
const startEndpoint = async (answer: string) => {
  const seen: SeenRequest[] = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      seen.push({ url: request.url, headers: request.headers, body: JSON.parse(body || "{}") });
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 0,
          model: "qwen3",
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      response.write(chunk({ role: "assistant", content: answer }, null));
      response.write(chunk({}, "stop"));
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, seen, baseUrl: `http://127.0.0.1:${port}/v1` };
};

describe("AgentHost on a custom OpenAI-compatible endpoint", () => {
  let dataDir: string;
  let modelsPath: string;
  let modelRuntime: ModelRuntime;
  let envelopes: AgentEnvelope[];
  let host: AgentHost | undefined;
  let server: Server | undefined;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "custom-endpoint-"));
    modelsPath = join(dataDir, "pi", "models.json");
    modelRuntime = await ModelRuntime.create({ authPath: join(dataDir, "pi", "auth.json"), modelsPath });
    envelopes = [];
  });

  afterEach(async () => {
    host?.dispose();
    host = undefined;
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("sends the chat straight to the endpoint's base URL with its saved key", async () => {
    const endpoint = await startEndpoint("Hello from the custom endpoint.");
    server = endpoint.server;
    await addCustomProvider(modelRuntime, modelsPath, {
      name: "My LiteLLM",
      baseUrl: endpoint.baseUrl,
      apiKey: "sk-litellm-secret",
      modelIds: ["qwen3"],
      reasoning: false,
    });
    host = new AgentHost({
      dataDir,
      modelRuntime,
      broadcast: (envelope) => envelopes.push(envelope),
      tools: [getClusterVersionTool],
      getClusterStatus: () => "connected",
      getClusterApi: () => createFakeKubeJsonApi().api,
      getPodLogsTailLines: () => 500,
      getModelRef: () => ({ provider: "my-litellm", id: "qwen3" }),
      retry: false,
    });

    expect(await host.handleCommand("c1", { type: "prompt", message: "hi" })).toMatchObject({ success: true });
    const start = Date.now();
    while (!envelopes.some((e) => e.kind === "event" && e.payload.type === "agent_settled")) {
      if (Date.now() - start > 5000) throw new Error("timed out waiting for the run to settle");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(endpoint.seen).toHaveLength(1);
    expect(endpoint.seen[0]).toMatchObject({
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer sk-litellm-secret" },
      body: { model: "qwen3" },
    });
    // No routing header for a local proxy: the request is the endpoint's own.
    expect(endpoint.seen[0]?.headers).not.toHaveProperty("x-upstream-base-url");
    const text = envelopes
      .flatMap((e) => (e.kind === "event" && e.payload.type === "message_update" ? [e.payload] : []))
      .map((p) => (p.assistantMessageEvent.type === "text_delta" ? p.assistantMessageEvent.delta : ""))
      .join("");
    expect(text).toBe("Hello from the custom endpoint.");
  });
});
