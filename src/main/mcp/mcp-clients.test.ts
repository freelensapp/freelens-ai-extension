import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServersClient, type McpClient, McpClients } from "./mcp-clients";

import type { MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";

import type { McpServers } from "./mcp-configuration";

const STDIO = JSON.stringify({ mcpServers: { kubernetes: { command: "npx", args: ["mcp-server-kubernetes"] } } });
const HTTP = JSON.stringify({ mcpServers: { remote: { url: "https://mcp.example.com/mcp" } } });

const environmentOf = (clusterId: string) => ({ KUBECONFIG: `/run/freelens/${clusterId}`, PATH: "/usr/bin" });

// Clients that record the servers they were created with and whether they were
// closed, and a host whose clusters are connected unless a test says otherwise.
const createFakes = () => {
  const clients: { servers: McpServers; closed: boolean; tools: ToolSet }[] = [];
  const connected = new Set(["cluster-a", "cluster-b"]);
  const dependencies = {
    isConnected: vi.fn((clusterId: string) => connected.has(clusterId)),
    getEnvironment: vi.fn(async (clusterId: string) => {
      if (!connected.has(clusterId)) {
        throw new Error(`Cluster ${clusterId} is not connected`);
      }
      return environmentOf(clusterId);
    }),
    createClient: vi.fn((servers: McpServers): McpClient => {
      const record = {
        servers,
        closed: false,
        tools: { [`tool-${clients.length}`]: { description: "an MCP tool" } } as unknown as ToolSet,
      };
      clients.push(record);
      return {
        listTools: async () => record.tools,
        close: async () => {
          record.closed = true;
        },
      };
    }),
  };
  return { clients, connected, dependencies, mcpClients: new McpClients(dependencies) };
};

describe("McpClients", () => {
  it("starts one client per cluster, each with its cluster's environment", async () => {
    const { clients, mcpClients } = createFakes();

    await mcpClients.getTools("cluster-a", STDIO);
    await mcpClients.getTools("cluster-b", STDIO);

    expect(clients.map(({ servers }) => servers)).toEqual([
      { kubernetes: { command: "npx", args: ["mcp-server-kubernetes"], env: environmentOf("cluster-a") } },
      { kubernetes: { command: "npx", args: ["mcp-server-kubernetes"], env: environmentOf("cluster-b") } },
    ]);
    expect(mcpClients.clusterIds).toEqual(["cluster-a", "cluster-b"]);
  });

  it("keeps the servers running for the next request of the cluster", async () => {
    const { dependencies, mcpClients } = createFakes();

    const [first, second] = await Promise.all([
      mcpClients.getTools("cluster-a", STDIO),
      mcpClients.getTools("cluster-a", STDIO),
    ]);
    const third = await mcpClients.getTools("cluster-a", STDIO);

    expect(dependencies.createClient).toHaveBeenCalledOnce();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("stops the servers and starts new ones when the configuration changes", async () => {
    const { clients, mcpClients } = createFakes();

    await mcpClients.getTools("cluster-a", STDIO);
    await mcpClients.getTools("cluster-a", HTTP);

    expect(clients.map(({ closed }) => closed)).toEqual([true, false]);
    expect(clients[1]?.servers).toEqual({ remote: { url: "https://mcp.example.com/mcp" } });
  });

  it("asks for no environment when no server is a process", async () => {
    const { connected, dependencies, mcpClients } = createFakes();
    connected.delete("cluster-a");

    await mcpClients.getTools("cluster-a", HTTP);

    expect(dependencies.getEnvironment).not.toHaveBeenCalled();
  });

  it("leaves nothing running when a start fails, and tries again on the next request", async () => {
    const { connected, dependencies, mcpClients } = createFakes();
    connected.delete("cluster-a");

    await expect(mcpClients.getTools("cluster-a", STDIO)).rejects.toThrow("Cluster cluster-a is not connected");
    expect(mcpClients.clusterIds).toEqual([]);
    expect(dependencies.createClient).not.toHaveBeenCalled();

    connected.add("cluster-a");
    await mcpClients.getTools("cluster-a", STDIO);
    expect(dependencies.createClient).toHaveBeenCalledOnce();
  });

  it("stops a client whose tools fail to load", async () => {
    let closed = false;
    const failing = new McpClients({
      getEnvironment: async () => ({}),
      createClient: () => ({
        listTools: async () => {
          throw new Error("Connection closed");
        },
        close: async () => {
          closed = true;
        },
      }),
    });

    await expect(failing.getTools("cluster-a", STDIO)).rejects.toThrow("Connection closed");
    expect(closed).toBe(true);
    expect(failing.clusterIds).toEqual([]);
  });

  it.each([
    ["an empty configuration", ""],
    ["a configuration without servers", JSON.stringify({ mcpServers: {} })],
  ])("refuses %s and starts nothing", async (_name, configuration) => {
    const { dependencies, mcpClients } = createFakes();

    await expect(mcpClients.getTools("cluster-a", configuration)).rejects.toThrow("No MCP servers provided");
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(mcpClients.clusterIds).toEqual([]);
  });

  it("starts nothing when the servers are stopped while they start", async () => {
    const { dependencies, mcpClients } = createFakes();

    const starting = mcpClients.getTools("cluster-a", STDIO);
    await mcpClients.close("cluster-a");

    await expect(starting).rejects.toThrow("The MCP servers were stopped while they started.");
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });

  it("stops the servers of the clusters that are no longer connected", async () => {
    const { clients, connected, mcpClients } = createFakes();
    await mcpClients.getTools("cluster-a", STDIO);
    await mcpClients.getTools("cluster-b", STDIO);

    connected.delete("cluster-b");
    await mcpClients.closeDisconnected();

    expect(clients.map(({ closed }) => closed)).toEqual([false, true]);
    expect(mcpClients.clusterIds).toEqual(["cluster-a"]);
  });

  it("stops every server", async () => {
    const { clients, mcpClients } = createFakes();
    await mcpClients.getTools("cluster-a", STDIO);
    await mcpClients.getTools("cluster-b", HTTP);

    await mcpClients.closeAll();

    expect(clients.every(({ closed }) => closed)).toBe(true);
    expect(mcpClients.clusterIds).toEqual([]);
  });
});

describe("createServersClient", () => {
  // Clients of the AI SDK whose tools are named by the test, and which record
  // whether they were closed.
  const fakeConnect = (toolsOf: Record<string, string[]>) => {
    const closed: string[] = [];
    const connect = vi.fn(async (name: string) => {
      const tools = Object.fromEntries((toolsOf[name] ?? []).map((tool) => [tool, { description: tool }]));
      return {
        tools: async () => tools,
        close: async () => {
          closed.push(name);
        },
      } as unknown as MCPClient;
    });
    return { closed, connect };
  };

  it("joins the tools of every server under the names their servers give them", async () => {
    const { connect } = fakeConnect({ kubernetes: ["pods_list"], flux: ["reconcile"] });
    const client = createServersClient({ kubernetes: { command: "npx" }, flux: { url: "https://flux" } }, connect);

    expect(Object.keys(await client.listTools())).toEqual(["pods_list", "reconcile"]);
    expect(connect.mock.calls.map(([name]) => name)).toEqual(["kubernetes", "flux"]);
  });

  it("fails the start when two servers have a tool of the same name, and closes them all", async () => {
    const { closed, connect } = fakeConnect({ one: ["list"], two: ["list"] });
    const client = createServersClient({ one: { command: "a" }, two: { command: "b" } }, connect);

    await expect(client.listTools()).rejects.toThrow('Two MCP servers have a tool named "list".');
    await client.close();
    expect(closed.sort()).toEqual(["one", "two"]);
  });
});

describe("McpClients with a real stdio server", () => {
  const server = fileURLToPath(new URL("../../../test/fixtures/environment-mcp-server.mjs", import.meta.url));
  const configuration = JSON.stringify({ mcpServers: { environment: { command: process.execPath, args: [server] } } });
  let mcpClients: McpClients | undefined;

  afterEach(async () => {
    await mcpClients?.closeAll();
  });

  const isRunning = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("runs the server with the cluster's environment and ends its process on close", async () => {
    mcpClients = new McpClients({
      getEnvironment: async (clusterId) => ({ KUBECONFIG: `/run/freelens/${clusterId}` }),
    });

    const tools = await mcpClients.getTools("cluster-a", configuration);
    expect(Object.keys(tools)).toEqual(["showEnvironment"]);
    // The text the server answered with, as the content of the tool's result.
    const execute = tools.showEnvironment?.execute as (input: unknown, options: unknown) => Promise<unknown>;
    const result = (await execute({}, { toolCallId: "call-1", messages: [] })) as { content: { text: string }[] };
    const { kubeconfig, pid } = JSON.parse(result.content[0]?.text ?? "{}") as { kubeconfig: string; pid: number };

    expect(kubeconfig).toBe("/run/freelens/cluster-a");
    expect(isRunning(pid)).toBe(true);

    await mcpClients.close("cluster-a");
    await vi.waitFor(() => expect(isRunning(pid)).toBe(false));
  });
});
