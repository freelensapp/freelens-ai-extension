import { describe, expect, it } from "vitest";
import { isStdioServer, parseMcpServers, withClusterEnvironment, withoutElicitation } from "./mcp-configuration";

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

describe("withoutElicitation", () => {
  it("turns elicitation off for stdio and HTTP servers, also where the server turned it on", () => {
    expect(
      withoutElicitation({
        kubernetes: { command: "npx" },
        remote: { url: "https://mcp.example.com/mcp", mode: "modern" },
        asking: { transport: "http", url: "https://mcp.example.com/mcp", elicitation: true },
      }),
    ).toEqual({
      kubernetes: { command: "npx", elicitation: false },
      remote: { url: "https://mcp.example.com/mcp", mode: "modern", elicitation: false },
      asking: { transport: "http", url: "https://mcp.example.com/mcp", elicitation: false },
    });
  });

  it("leaves SSE servers, legacy servers and invalid entries as they are", () => {
    const servers = {
      sse: { transport: "sse", url: "https://mcp.example.com/sse" },
      typed: { type: "sse", url: "https://mcp.example.com/sse" },
      legacy: { command: "npx", mode: "legacy" },
      invalid: "npx",
    };

    expect(withoutElicitation(servers)).toEqual(servers);
  });
});
