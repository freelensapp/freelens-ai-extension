import { describe, expect, it } from "vitest";
import { isStdioServer, parseMcpServers, toServerTransport, withClusterEnvironment } from "./mcp-configuration";

describe("parseMcpServers", () => {
  it("reads the servers of the configuration", () => {
    expect(
      parseMcpServers(
        JSON.stringify({ mcpServers: { kubernetes: { command: "npx", args: ["mcp-server-kubernetes"] } } }),
      ),
    ).toEqual({ kubernetes: { command: "npx", args: ["mcp-server-kubernetes"] } });
  });

  it.each([
    ["an empty configuration", ""],
    ["invalid JSON", "{ mcpServers: "],
    ["a configuration without mcpServers", JSON.stringify({ servers: {} })],
    ["mcpServers that is not an object", JSON.stringify({ mcpServers: ["a"] })],
  ])("gives no servers for %s", (_name, configuration) => {
    expect(parseMcpServers(configuration)).toEqual({});
  });
});

describe("isStdioServer", () => {
  it.each([
    [{ command: "npx" }, true],
    [{ transport: "stdio", command: "npx" }, true],
    [{ type: "stdio", command: "npx" }, true],
    [{ url: "http://localhost:3000/mcp" }, false],
    [{ transport: "http", url: "http://localhost:3000/mcp" }, false],
    [{ transport: "sse", url: "http://localhost:3000/sse", command: "ignored" }, false],
    ["not an object", false],
  ])("%j is a stdio server: %s", (server, expected) => {
    expect(isStdioServer(server)).toBe(expected);
  });
});

describe("withClusterEnvironment", () => {
  const environment = { KUBECONFIG: "/run/freelens/cluster-a", PATH: "/usr/local/bin:/usr/bin" };

  it("puts the cluster's environment under the env of every stdio server", () => {
    expect(
      withClusterEnvironment(
        {
          kubernetes: { command: "npx", args: ["mcp-server-kubernetes"] },
          other: { transport: "stdio", command: "x" },
        },
        environment,
      ),
    ).toEqual({
      kubernetes: { command: "npx", args: ["mcp-server-kubernetes"], env: environment },
      other: { transport: "stdio", command: "x", env: environment },
    });
  });

  it("lets a variable of the server win", () => {
    expect(
      withClusterEnvironment(
        { kubernetes: { command: "npx", env: { KUBECONFIG: "/home/me/.kube/other" } } },
        environment,
      ).kubernetes,
    ).toEqual({ command: "npx", env: { KUBECONFIG: "/home/me/.kube/other", PATH: "/usr/local/bin:/usr/bin" } });
  });

  it("leaves HTTP and SSE servers as they are", () => {
    const servers = { remote: { url: "https://mcp.example.com/mcp", headers: { authorization: "Bearer t" } } };

    expect(withClusterEnvironment(servers, environment)).toEqual(servers);
  });
});

describe("toServerTransport", () => {
  it("reads a stdio server, with its arguments, environment and directory", () => {
    expect(
      toServerTransport("kubernetes", {
        command: "npx",
        args: ["mcp-server-kubernetes"],
        env: { KUBECONFIG: "/run/kube", DEBUG: 1 },
        cwd: "/tmp",
      }),
    ).toEqual({
      type: "stdio",
      command: "npx",
      args: ["mcp-server-kubernetes"],
      env: { KUBECONFIG: "/run/kube", DEBUG: "1" },
      cwd: "/tmp",
    });
    expect(toServerTransport("explicit", { transport: "stdio", command: "server" })).toEqual({
      type: "stdio",
      command: "server",
    });
  });

  it("reads an HTTP server by default and an SSE server by its transport or type", () => {
    expect(
      toServerTransport("remote", { url: "https://mcp.example.com/mcp", headers: { authorization: "t" } }),
    ).toEqual({ type: "http", url: "https://mcp.example.com/mcp", headers: { authorization: "t" } });
    expect(toServerTransport("sse", { transport: "sse", url: "https://mcp.example.com/sse" })).toEqual({
      type: "sse",
      url: "https://mcp.example.com/sse",
    });
    expect(toServerTransport("typed", { type: "sse", url: "https://mcp.example.com/sse" })).toMatchObject({
      type: "sse",
    });
  });

  it.each([
    ["npx", 'The MCP server "bad" is not an object.'],
    [{ transport: "stdio" }, 'The MCP server "bad" has no "command".'],
    [{ transport: "websocket", url: "ws://mcp" }, 'The MCP server "bad" has an unknown transport "websocket".'],
    [{ headers: {} }, 'The MCP server "bad" has no "url".'],
  ])("refuses %j with a message that names the server", (server, message) => {
    expect(() => toServerTransport("bad", server)).toThrow(message);
  });
});
