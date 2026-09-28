import { describe, expect, it } from "vitest";
import { parseMcpConfiguration } from "./mcp-servers";

const config = (mcpServers: unknown) => JSON.stringify({ mcpServers });

describe("parseMcpConfiguration", () => {
  it("returns no servers for an empty configuration", () => {
    expect(parseMcpConfiguration("")).toEqual([]);
    expect(parseMcpConfiguration("  ")).toEqual([]);
  });

  it("detects a stdio server from its command", () => {
    const [server] = parseMcpConfiguration(
      config({ fs: { command: "npx", args: ["-y", "server"], env: { TOKEN: "t", PORT: 1 } } }),
    );
    expect(server).toEqual({
      name: "fs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "server"],
      env: { TOKEN: "t", PORT: "1" },
      cwd: undefined,
      url: undefined,
      headers: undefined,
    });
  });

  it("detects a streamable HTTP server from its url", () => {
    const [server] = parseMcpConfiguration(config({ web: { url: "https://mcp.example.com", headers: { A: "b" } } }));
    expect(server.transport).toBe("streamable-http");
    expect(server.url).toBe("https://mcp.example.com");
    expect(server.headers).toEqual({ A: "b" });
  });

  it('maps the former adapter\'s "http" transport to streamable HTTP and keeps sse', () => {
    const servers = parseMcpConfiguration(
      config({ a: { transport: "http", url: "https://a" }, b: { transport: "sse", url: "https://b" } }),
    );
    expect(servers.map((server) => server.transport)).toEqual(["streamable-http", "sse"]);
  });

  it("rejects a configuration without mcpServers", () => {
    expect(() => parseMcpConfiguration("{}")).toThrow("'mcpServers' property is missing");
  });

  it("rejects servers without a command or url", () => {
    expect(() => parseMcpConfiguration(config({ broken: {} }))).toThrow('either "command" (stdio) or "url"');
    expect(() => parseMcpConfiguration(config({ broken: { transport: "stdio" } }))).toThrow('needs a "command"');
    expect(() => parseMcpConfiguration(config({ broken: { transport: "sse" } }))).toThrow('needs a "url"');
  });

  it("rejects invalid JSON", () => {
    expect(() => parseMcpConfiguration("{")).toThrow();
  });
});
