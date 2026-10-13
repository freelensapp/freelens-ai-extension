// Pure helpers for the MCP configuration of the preferences, the JSON of
// `{ "mcpServers": { "<name>": <connection> } }`. Kept free of host
// dependencies so they are unit-tested directly.

// The servers of the configuration by name, each as the user wrote it.
// `MultiServerMCPClient` validates every connection itself when it is created.
export type McpServers = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The servers of the configuration. An empty or invalid configuration has no
 * servers; the MCP client then refuses to start with "No MCP servers
 * provided", which the chat shows.
 */
export const parseMcpServers = (configuration: string): McpServers => {
  if (configuration.trim() === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(configuration);
    if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
      console.error("Invalid MCP configuration: 'mcpServers' property is missing.");
      return {};
    }
    return parsed.mcpServers;
  } catch (error) {
    console.error("Failed to parse MCP configuration:", error);
    return {};
  }
};

/**
 * Whether a server runs as a child process: an explicit stdio transport, or
 * no transport and a command, as `MultiServerMCPClient` infers it.
 */
export const isStdioServer = (server: unknown): server is Record<string, unknown> => {
  if (!isRecord(server)) {
    return false;
  }
  const transport = server.transport ?? server.type;
  if (transport !== undefined) {
    return transport === "stdio";
  }
  return typeof server.command === "string";
};

/**
 * The servers with the environment of the chat's cluster under the `env` of
 * every stdio server, so a server such as `mcp-server-kubernetes` talks to that
 * cluster through Freelens rather than to the kubeconfig's current context, and
 * `npx` and other commands named without a path resolve on its `PATH`. A
 * variable the user set on the server wins. HTTP and SSE servers are left as
 * they are.
 */
export const withClusterEnvironment = (servers: McpServers, environment: Record<string, string>): McpServers =>
  Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      if (!isStdioServer(server)) {
        return [name, server];
      }
      const own = isRecord(server.env) ? server.env : {};
      return [name, { ...server, env: { ...environment, ...own } }];
    }),
  );
