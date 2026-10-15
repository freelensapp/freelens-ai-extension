// A minimal MCP server over stdio for the tests of the MCP clients: one tool,
// `showEnvironment`, that answers with the server's KUBECONFIG and process id,
// so a test sees the environment the server was started with and can check
// that the process is gone after the client closes.
//
// It speaks just enough of the protocol (newline-delimited JSON-RPC) for
// `MultiServerMCPClient`: initialize, tools/list and tools/call.
import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

const results = {
  initialize: (params) => ({
    protocolVersion: params.protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: "environment", version: "1.0.0" },
  }),
  "tools/list": () => ({
    tools: [
      {
        name: "showEnvironment",
        description: "Shows the KUBECONFIG and the process id of the server",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }),
  "tools/call": () => ({
    content: [{ type: "text", text: JSON.stringify({ kubeconfig: process.env.KUBECONFIG ?? null, pid: process.pid }) }],
  }),
  ping: () => ({}),
};

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) {
    return;
  }
  const result = results[message.method];
  if (result) {
    send({ id: message.id, result: result(message.params ?? {}) });
  } else {
    send({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
});
