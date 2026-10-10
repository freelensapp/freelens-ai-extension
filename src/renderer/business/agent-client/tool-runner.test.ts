import { describe, expect, it } from "vitest";
import { runToolRequest } from "./tool-runner";

const request = (toolName: string, args: Record<string, unknown> = {}) => ({ requestId: "r1", toolName, args });

describe("runToolRequest", () => {
  it("replies with the implementation's text", async () => {
    const reply = await runToolRequest(request("getClusterVersion"), {
      getClusterVersion: async () => '{"version":"v1.31.2"}',
    });

    expect(reply).toEqual({ text: '{"version":"v1.31.2"}', isError: false });
  });

  it("passes the arguments through", async () => {
    const reply = await runToolRequest(request("echo", { name: "web-1" }), {
      echo: (args) => String(args.name),
    });

    expect(reply).toEqual({ text: "web-1", isError: false });
  });

  it("replies with an error for an unknown tool", async () => {
    const reply = await runToolRequest(request("deleteEverything"), {});

    expect(reply).toEqual({ text: "Unknown tool: deleteEverything", isError: true });
  });

  it("replies 'Cluster not connected' without running the tool when the cluster is disconnected", async () => {
    let ran = false;
    const reply = await runToolRequest(
      request("getClusterVersion"),
      {
        getClusterVersion: () => {
          ran = true;
          return "v1";
        },
      },
      { isClusterConnected: () => false },
    );

    expect(reply).toEqual({ text: "Cluster not connected", isError: true });
    expect(ran).toBe(false);
  });

  it("turns a thrown error into an error reply", async () => {
    const reply = await runToolRequest(request("getClusterVersion"), {
      getClusterVersion: async () => {
        throw new Error("cluster not connected");
      },
    });

    expect(reply).toEqual({ text: "getClusterVersion failed: cluster not connected", isError: true });
  });
});
