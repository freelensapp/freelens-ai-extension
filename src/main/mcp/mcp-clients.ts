// The MCP servers of the preferences, run in main: one `MultiServerMCPClient`
// per cluster, so each chat's servers talk to its own cluster. A stdio server is
// a child process of main, started with the environment of the cluster's
// terminal (`Main.Shell.getEnvironment`); HTTP and SSE servers are reached from
// main too. Nothing of an MCP server leaves main: the renderer sees only the
// agent's stream and its approvals, through the bridge.

import { Common, Main } from "@freelensapp/extensions";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import useLog from "../utils/logger";
import { isStdioServer, type McpServers, parseMcpServers, withClusterEnvironment } from "./mcp-configuration";

import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Connection } from "@langchain/mcp-adapters";

export interface McpClient {
  getTools(): Promise<StructuredToolInterface[]>;
  // Stops every server of the client; a stdio server's process ends with it.
  close(): Promise<void>;
}

export interface McpClientsDependencies {
  isConnected(clusterId: string): boolean;
  getEnvironment(clusterId: string): Promise<Record<string, string>>;
  createClient(servers: McpServers): McpClient;
}

const hostDependencies: McpClientsDependencies = {
  isConnected: (clusterId) =>
    Main.Catalog.getClusterById(clusterId)?.status === Common.Clusters.ClusterConnectionStatus.CONNECTED,
  getEnvironment: (clusterId) => Main.Shell.getEnvironment(clusterId),
  createClient: (servers) =>
    new MultiServerMCPClient({
      throwOnLoadError: true,
      prefixToolNameWithServerName: false,
      additionalToolNamePrefix: "",
      useStandardContentBlocks: true,
      // The connections are the user's JSON; the client validates them.
      mcpServers: servers as Record<string, Connection>,
    }),
};

interface Entry {
  configuration: string;
  client?: McpClient;
  tools: Promise<StructuredToolInterface[]>;
  closed: boolean;
}

export class McpClients {
  private readonly log = useLog("McpClients").log;
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly dependencies: McpClientsDependencies = hostDependencies) {}

  /**
   * The tools of the cluster's MCP servers. The servers start on the first
   * request for a cluster and keep running for the next ones; a different
   * configuration stops them and starts the new ones. A failed start leaves
   * nothing running, so the next request tries again.
   */
  getTools(clusterId: string, configuration: string): Promise<StructuredToolInterface[]> {
    const current = this.entries.get(clusterId);
    if (current && current.configuration === configuration) {
      return current.tools;
    }
    if (current) {
      void this.close(clusterId);
    }

    const entry: Entry = { configuration, closed: false, tools: Promise.resolve([]) };
    entry.tools = this.start(clusterId, entry);
    this.entries.set(clusterId, entry);
    return entry.tools;
  }

  private async start(clusterId: string, entry: Entry): Promise<StructuredToolInterface[]> {
    try {
      const servers = parseMcpServers(entry.configuration);
      // Only a process needs the environment, which needs a connected cluster.
      const environment = Object.values(servers).some(isStdioServer)
        ? await this.dependencies.getEnvironment(clusterId)
        : {};
      if (entry.closed) {
        throw new Error("The MCP servers were stopped while they started.");
      }
      entry.client = this.dependencies.createClient(withClusterEnvironment(servers, environment));
      const tools = await entry.client.getTools();
      for (const tool of tools) {
        this.log.debug(`Loaded MCP tool ${tool.name} for cluster ${clusterId}: ${tool.description}`);
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
