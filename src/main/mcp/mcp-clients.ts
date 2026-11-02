// The MCP servers of the preferences, run in main: one client per cluster, so
// each chat's servers talk to its own cluster. A stdio server is a child process
// of main, started with the environment of the cluster's terminal
// (`Main.Shell.getEnvironment`); HTTP and SSE servers are reached from main
// with the host's fetch, so the user's proxy and certificate preferences apply.
// Nothing of an MCP server leaves main: the renderer sees only the agent's
// stream and its approvals, through the bridge.

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { Common, Main } from "@freelensapp/extensions";
import useLog from "../utils/logger";
import {
  isStdioServer,
  type McpServers,
  parseMcpServers,
  toServerTransport,
  withClusterEnvironment,
} from "./mcp-configuration";

import type { ToolSet } from "ai";

export interface McpClient {
  // The tools of every server of the client, by the names their servers give
  // them; starts the servers on the first call.
  listTools(): Promise<ToolSet>;
  // Stops every server of the client; a stdio server's process ends with it.
  close(): Promise<void>;
}

export interface McpClientsDependencies {
  isConnected(clusterId: string): boolean;
  getEnvironment(clusterId: string): Promise<Record<string, string>>;
  createClient(servers: McpServers): McpClient;
}

// Read at call time: the namespace is the host's, and exists only once the
// extension is loaded.
const hostFetch: typeof globalThis.fetch = (input, init) => Main.Util.fetch(input, init);

const connect = (name: string, server: unknown): Promise<MCPClient> => {
  const transport = toServerTransport(name, server);
  return createMCPClient({
    clientName: "freelens-ai-extension",
    // No capabilities: in particular no elicitation, which would ask the user
    // for input in the middle of a tool call, and which the chat cannot show.
    transport:
      transport.type === "stdio"
        ? new StdioMCPTransport({
            command: transport.command,
            args: transport.args,
            env: transport.env,
            cwd: transport.cwd,
          })
        : { type: transport.type, url: transport.url, headers: transport.headers, fetch: hostFetch },
  });
};

/**
 * A client of the AI SDK for every server of the configuration. The tools keep
 * the names their servers give them, which the custom agent rules of the
 * preferences may name, so two servers with a tool of the same name fail the
 * start.
 */
export const createServersClient = (servers: McpServers, connectServer = connect): McpClient => {
  const clients: MCPClient[] = [];
  let closed = false;

  const close = async () => {
    closed = true;
    await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  };

  const start = async (name: string, server: unknown): Promise<ToolSet> => {
    const client = await connectServer(name, server);
    clients.push(client);
    if (closed) {
      await close();
      throw new Error("The MCP servers were stopped while they started.");
    }
    return client.tools();
  };

  return {
    listTools: async () => {
      const toolSets = await Promise.all(Object.entries(servers).map(([name, server]) => start(name, server)));
      const tools: ToolSet = {};
      for (const toolSet of toolSets) {
        for (const [name, tool] of Object.entries(toolSet)) {
          if (name in tools) {
            throw new Error(`Two MCP servers have a tool named "${name}".`);
          }
          tools[name] = tool;
        }
      }
      return tools;
    },
    close,
  };
};

const hostDependencies: McpClientsDependencies = {
  isConnected: (clusterId) =>
    Main.Catalog.getClusterById(clusterId)?.status === Common.Clusters.ClusterConnectionStatus.CONNECTED,
  getEnvironment: (clusterId) => Main.Shell.getEnvironment(clusterId),
  createClient: (servers) => createServersClient(servers),
};

interface Entry {
  configuration: string;
  client?: McpClient;
  tools: Promise<ToolSet>;
  closed: boolean;
}

export class McpClients {
  private readonly log = useLog("McpClients").log;
  private readonly entries = new Map<string, Entry>();
  private readonly dependencies: McpClientsDependencies;

  // The host's by default; a test replaces some of them.
  constructor(dependencies: Partial<McpClientsDependencies> = {}) {
    this.dependencies = { ...hostDependencies, ...dependencies };
  }

  /**
   * The tools of the cluster's MCP servers. The servers start on the first
   * request for a cluster and keep running for the next ones; a different
   * configuration stops them and starts the new ones. A failed start leaves
   * nothing running, so the next request tries again.
   */
  getTools(clusterId: string, configuration: string): Promise<ToolSet> {
    const current = this.entries.get(clusterId);
    if (current && current.configuration === configuration) {
      return current.tools;
    }
    if (current) {
      void this.close(clusterId);
    }

    const entry: Entry = { configuration, closed: false, tools: Promise.resolve({}) };
    // Kept before the start, which removes it again when it fails before its
    // first await.
    this.entries.set(clusterId, entry);
    entry.tools = this.start(clusterId, entry);
    return entry.tools;
  }

  private async start(clusterId: string, entry: Entry): Promise<ToolSet> {
    try {
      const servers = parseMcpServers(entry.configuration);
      if (Object.keys(servers).length === 0) {
        throw new Error("No MCP servers provided");
      }
      // Only a process needs the environment, which needs a connected cluster.
      const environment = Object.values(servers).some(isStdioServer)
        ? await this.dependencies.getEnvironment(clusterId)
        : {};
      if (entry.closed) {
        throw new Error("The MCP servers were stopped while they started.");
      }
      entry.client = this.dependencies.createClient(withClusterEnvironment(servers, environment));
      const tools = await entry.client.listTools();
      for (const [name, tool] of Object.entries(tools)) {
        this.log.debug(`Loaded MCP tool ${name} for cluster ${clusterId}: ${tool.description}`);
      }
      return tools;
    } catch (error) {
      if (this.entries.get(clusterId) === entry) {
        this.entries.delete(clusterId);
      }
      await this.stop(entry);
      throw error;
    }
  }

  private async stop(entry: Entry) {
    entry.closed = true;
    try {
      await entry.client?.close();
    } catch (error) {
      this.log.error("Failed to stop the MCP servers: ", error);
    }
  }

  /** Stops the MCP servers of a cluster. */
  async close(clusterId: string): Promise<void> {
    const entry = this.entries.get(clusterId);
    if (!entry) {
      return;
    }
    this.entries.delete(clusterId);
    await this.stop(entry);
  }

  /** Stops the MCP servers of the clusters that are no longer connected. */
  async closeDisconnected(): Promise<void> {
    const disconnected = [...this.entries.keys()].filter((clusterId) => !this.dependencies.isConnected(clusterId));
    await Promise.all(disconnected.map((clusterId) => this.close(clusterId)));
  }

  /** Stops every MCP server. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((clusterId) => this.close(clusterId)));
  }

  get clusterIds(): string[] {
    return [...this.entries.keys()];
  }
}
