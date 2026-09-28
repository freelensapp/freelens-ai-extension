// MCP servers configured in the extension preferences, connected through the
// Strands `McpClient`. Their tools are registered on the same single agent as
// the built-in Kubernetes tools.
//
// The preference holds a Claude-Desktop-style JSON document:
//   { "mcpServers": { "<name>": { "command", "args", "env", "cwd" } | { "url", "headers", "transport" } } }
// `transport` accepts "stdio", "sse", "streamable-http" and, for backward
// compatibility with configurations written for the former LangChain adapter,
// "http" (an alias of "streamable-http").

import { McpClient } from "@strands-agents/sdk";

import type { Tool } from "@strands-agents/sdk";

export type McpTransportKind = "stdio" | "sse" | "streamable-http";

export interface McpServerDefinition {
  name: string;
  transport: McpTransportKind;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toStringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, String(entry)]));
};

const resolveTransport = (server: Record<string, unknown>): McpTransportKind => {
  switch (server.transport) {
    case "stdio":
    case "sse":
    case "streamable-http":
      return server.transport;
    case "http":
      return "streamable-http";
    default:
      if (typeof server.command === "string") {
        return "stdio";
      }
      if (typeof server.url === "string") {
        return "streamable-http";
      }
      throw new Error('MCP server config must include either "command" (stdio) or "url" (http)');
  }
};

/**
 * Parse the MCP configuration preference into server definitions. An empty
 * configuration yields no servers; a malformed one throws with a readable
 * message so the chat can report it.
 */
export function parseMcpConfiguration(mcpConfiguration: string): McpServerDefinition[] {
  if (mcpConfiguration.trim() === "") {
    return [];
  }
  const parsed: unknown = JSON.parse(mcpConfiguration);
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    throw new Error("Invalid MCP configuration: 'mcpServers' property is missing.");
  }
  return Object.entries(parsed.mcpServers).map(([name, server]) => {
    if (!isRecord(server)) {
      throw new Error(`Invalid MCP configuration: server "${name}" must be an object.`);
    }
    const transport = resolveTransport(server);
    if (transport === "stdio" && typeof server.command !== "string") {
      throw new Error(`Invalid MCP configuration: server "${name}" needs a "command" for the stdio transport.`);
    }
    if (transport !== "stdio" && typeof server.url !== "string") {
      throw new Error(`Invalid MCP configuration: server "${name}" needs a "url" for the ${transport} transport.`);
    }
    return {
      name,
      transport,
      command: typeof server.command === "string" ? server.command : undefined,
      args: Array.isArray(server.args) ? server.args.map(String) : undefined,
      env: toStringRecord(server.env),
      cwd: typeof server.cwd === "string" ? server.cwd : undefined,
      url: typeof server.url === "string" ? server.url : undefined,
      headers: toStringRecord(server.headers),
    };
  });
}

// Builds the client for one server. The stdio and SSE transports come from the
// MCP SDK and are loaded lazily: the renderer is an Electron renderer with Node
// builtins, so spawning a stdio server works as it did with the former adapter.
async function createMcpClient(server: McpServerDefinition): Promise<McpClient> {
  const options = { applicationName: server.name, disableMcpInstrumentation: true };
  switch (server.transport) {
    case "stdio": {
      const { StdioClientTransport, getDefaultEnvironment } = await import("@modelcontextprotocol/sdk/client/stdio.js");
      const transport = new StdioClientTransport({
        command: server.command as string,
        args: server.args,
        env: server.env ? { ...getDefaultEnvironment(), ...server.env } : undefined,
        cwd: server.cwd,
      });
      return new McpClient({ ...options, transport });
    }
    case "sse": {
      const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
      const transport = new SSEClientTransport(
        new URL(server.url as string),
        server.headers ? { requestInit: { headers: server.headers } } : undefined,
      );
      return new McpClient({ ...options, transport });
    }
    default:
      return new McpClient({ ...options, url: server.url, headers: server.headers });
  }
}

export interface McpConnection {
  clients: McpClient[];
  tools: Tool[];
}

/**
 * Connect every configured server and list its tools. Fails fast when a server
 * cannot be reached, as the former adapter did (`throwOnLoadError`).
 */
export async function connectMcpServers(mcpConfiguration: string): Promise<McpConnection> {
  const clients = await Promise.all(parseMcpConfiguration(mcpConfiguration).map(createMcpClient));
  try {
    const toolLists = await Promise.all(clients.map((client) => client.listTools()));
    return { clients, tools: toolLists.flat() };
  } catch (error) {
    await disconnectMcpServers({ clients, tools: [] });
    throw error;
  }
}

export async function disconnectMcpServers(connection: McpConnection): Promise<void> {
  await Promise.allSettled(connection.clients.map((client) => client.disconnect()));
}
