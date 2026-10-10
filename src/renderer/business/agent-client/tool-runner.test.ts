import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { type ClusterTool, runToolRequest } from "./tool-runner";

const request = (toolName: string, args: Record<string, unknown> = {}) => ({ requestId: "r1", toolName, args });

const tool = (name: string, run: ClusterTool["run"], parameters = Type.Object({})): ClusterTool => ({
  definition: { name, label: name, description: name, parameters, mutating: false, requiresApprovalByDefault: false },
  run,
});

const tools = (...list: ClusterTool[]) => Object.fromEntries(list.map((t) => [t.definition.name, t]));

describe("runToolRequest", () => {
  it("replies with the implementation's text", async () => {
    const reply = await runToolRequest(
      request("getClusterVersion"),
      tools(tool("getClusterVersion", async () => '{"version":"v1.31.2"}')),
    );

    expect(reply).toEqual({ text: '{"version":"v1.31.2"}', isError: false });
  });

  it("passes the arguments through", async () => {
    const reply = await runToolRequest(
      request("echo", { name: "web-1" }),
      tools(tool("echo", (args) => String(args.name), Type.Object({ name: Type.String() }))),
    );

    expect(reply).toEqual({ text: "web-1", isError: false });
  });

  it("replies with an error for an unknown tool", async () => {
    const reply = await runToolRequest(request("deleteEverything"), {});

    expect(reply).toEqual({ text: "Unknown tool: deleteEverything", isError: true });
  });

  it("rejects arguments that do not match the tool's schema without running it", async () => {
    let ran = false;
    const reply = await runToolRequest(
      request("getKubernetesResource", { kind: "Pod", name: 7 }),
      tools(
        tool(
          "getKubernetesResource",
          () => {
            ran = true;
            return "{}";
          },
          Type.Object({ kind: Type.String(), name: Type.String(), namespace: Type.String() }),
        ),
      ),
    );

    expect(reply).toEqual({
      text:
        "Invalid arguments for getKubernetesResource: " +
        "must have required properties namespace; /name must be string",
      isError: true,
    });
    expect(ran).toBe(false);
  });

  it("replies 'Cluster not connected' without running the tool when the cluster is disconnected", async () => {
    let ran = false;
    const reply = await runToolRequest(
      request("getClusterVersion"),
      tools(
        tool("getClusterVersion", () => {
          ran = true;
          return "v1";
        }),
      ),
      { isClusterConnected: () => false },
    );

    expect(reply).toEqual({ text: "Cluster not connected", isError: true });
    expect(ran).toBe(false);
  });

  it("turns a thrown error into an error reply", async () => {
    const reply = await runToolRequest(
      request("getClusterVersion"),
      tools(
        tool("getClusterVersion", async () => {
          throw new Error("cluster not connected");
        }),
      ),
    );

    expect(reply).toEqual({ text: "getClusterVersion failed: cluster not connected", isError: true });
  });
});
