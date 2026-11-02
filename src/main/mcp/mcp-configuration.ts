// Pure helpers for the MCP configuration of the preferences, the JSON of
// `{ "mcpServers": { "<name>": <connection> } }`. Kept free of host
// dependencies so they are unit-tested directly.

// The servers of the configuration by name, each as the user wrote it, checked
// by `toServerTransport` when its client is created.
export type McpServers = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The servers of the configuration. An empty or invalid configuration has no
 * servers; `McpClients` then refuses to start with "No MCP servers provided",
 * which the chat shows.
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
 * no transport and a command.
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

// How a server of the configuration is reached.
export type McpServerTransport =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { type: "http" | "sse"; url: string; headers?: Record<string, string> };

const stringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .map(([key, entry]) => [key, String(entry)]),
  );
};

/**
 * The transport of a server of the configuration, in the format the
 * preferences have always had (that of LangChain's MCP adapters): a stdio
 * server with `command`, `args`, `env` and `cwd`, or an HTTP or SSE server with
 * `url` and `headers`. `transport` or `type` names the transport; without
 * either, a `command` is a stdio server and a `url` an HTTP one. Throws a
 * message that names the server when it is neither.
 */
export const toServerTransport = (name: string, server: unknown): McpServerTransport => {
  if (!isRecord(server)) {
    throw new Error(`The MCP server "${name}" is not an object.`);
  }
  // Kept apart from `server`, which the stdio guard below narrows.
  const remote: Record<string, unknown> = server;
  if (isStdioServer(server)) {
    if (typeof server.command !== "string" || server.command.length === 0) {
      throw new Error(`The MCP server "${name}" has no "command".`);
    }
    return {
      type: "stdio",
      command: server.command,
      ...(Array.isArray(server.args) ? { args: server.args.map(String) } : {}),
      ...(isRecord(server.env) ? { env: stringRecord(server.env) } : {}),
      ...(typeof server.cwd === "string" ? { cwd: server.cwd } : {}),
    };
  }
  const transport = remote.transport ?? remote.type ?? "http";
  if (transport !== "http" && transport !== "sse") {
    throw new Error(`The MCP server "${name}" has an unknown transport "${String(transport)}".`);
  }
  if (typeof remote.url !== "string" || remote.url.length === 0) {
    throw new Error(`The MCP server "${name}" has no "url".`);
  }
  return {
    type: transport,
    url: remote.url,
    ...(isRecord(remote.headers) ? { headers: stringRecord(remote.headers) } : {}),
  };
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
