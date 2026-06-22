import { describe, expect, it } from "vitest";
import { belongsToCluster, checkpointNamespace } from "./checkpoint-namespace";

describe("checkpointNamespace", () => {
  it("qualifies the agent kind with the cluster id", () => {
    expect(checkpointNamespace("cluster-a", "freelens")).toBe("cluster-a::freelens");
    expect(checkpointNamespace("cluster-b", "mcp")).toBe("cluster-b::mcp");
  });

  it("keeps different clusters in distinct namespaces", () => {
    expect(checkpointNamespace("cluster-a", "freelens")).not.toBe(checkpointNamespace("cluster-b", "freelens"));
  });
});

describe("belongsToCluster", () => {
  it("matches namespaces created for the same cluster", () => {
    const namespace = checkpointNamespace("cluster-a", "freelens");
    expect(belongsToCluster(namespace, "cluster-a")).toBe(true);
  });

  it("does not match another cluster's namespace", () => {
    const namespace = checkpointNamespace("cluster-a", "freelens");
    expect(belongsToCluster(namespace, "cluster-b")).toBe(false);
  });

  it("does not match on a cluster id that is only a prefix of another", () => {
    const namespace = checkpointNamespace("cluster-a-extra", "mcp");
    expect(belongsToCluster(namespace, "cluster-a")).toBe(false);
  });
});
