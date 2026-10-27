import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "../../../common/agent-tools";
import { type Cluster, type ClusterResource, createClusterTools, type ResourceApi } from "./cluster-tools";
import { runToolRequest } from "./tool-runner";

const pod = (name: string, namespace: string): ClusterResource => ({
  name,
  namespace,
  metadata: { name, namespace },
  spec: { containers: [{ name: "app", image: "nginx:1.27" }] },
});

// Every change a tool makes to the fake cluster, in order.
let writes: unknown[][] = [];
beforeEach(() => {
  writes = [];
});

const namespacedApi = (kind: string, items: ClusterResource[]): ResourceApi => ({
  namespaced: true,
  get: async (name, namespace) => items.find((item) => item.name === name && item.namespace === namespace),
  create: async (...args) => void writes.push(["create", kind, ...args]),
  update: async (...args) => void writes.push(["update", kind, ...args]),
  patch: async (...args) => void writes.push(["patch", kind, ...args]),
  remove: async (...args) => void writes.push(["remove", kind, ...args]),
});

function fakeCluster(overrides: Partial<Cluster> = {}): Cluster {
  const apis: Record<string, ResourceApi> = {
    "Pod v1": namespacedApi("Pod", [pod("web-1", "shop")]),
    "Deployment apps/v1": namespacedApi("Deployment", [
      { name: "web", namespace: "shop", metadata: { name: "web", namespace: "shop" } },
    ]),
  };
  return {
    getResourceApi: (kind, apiVersion) =>
      apis[`${kind} ${apiVersion}`] ?? `No API serves kind "${kind}" at "${apiVersion}".`,
    deletePod: async (...args) => void writes.push(["deletePod", ...args]),
    restartWorkload: async (...args) => void writes.push(["restart", ...args]),
    ...overrides,
  };
}

const call = (toolName: string, args: Record<string, unknown> = {}, cluster = fakeCluster()) =>
  runToolRequest({ requestId: "r1", toolName, args }, createClusterTools(cluster));

// The read tools run in main (src/main/agent/tools/read-tools.ts); the frame
// runs the write tools.
describe("cluster tools", () => {
  it("has a frame implementation for every write tool and none for the read tools", () => {
    expect(Object.keys(createClusterTools(fakeCluster())).sort()).toEqual(
      AGENT_TOOLS.filter((tool) => tool.mutating)
        .map((tool) => tool.name)
        .sort(),
    );
  });

  it("replies 'Cluster not connected' when the cluster is disconnected", async () => {
    const reply = await runToolRequest(
      { requestId: "r1", toolName: "deletePod", args: { name: "web-1", namespace: "shop", mode: "evict" } },
      createClusterTools(fakeCluster()),
      { isClusterConnected: () => false },
    );

    expect(reply).toEqual({ text: "Cluster not connected", isError: true });
    expect(writes).toEqual([]);
  });

  describe("write tools", () => {
    it("createKubernetesResource applies the approved manifest", async () => {
      const data = { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: "api", namespace: "shop" } };
      const reply = await call("createKubernetesResource", {
        kind: "Deployment",
        name: "api",
        namespace: "shop",
        data,
      });

      expect(reply).toEqual({ text: 'Deployment "api" created successfully', isError: false });
      expect(writes).toEqual([["create", "Deployment", "api", "shop", data]]);
    });

    it("patchKubernetesResource patches the scale subresource of an existing workload", async () => {
      const data = { spec: { replicas: 3 } };
      const reply = await call("patchKubernetesResource", {
        kind: "Deployment",
        name: "web",
        namespace: "shop",
        data,
        subresource: "scale",
      });

      expect(reply).toEqual({ text: 'Deployment "web" scale subresource patched successfully', isError: false });
      expect(writes).toEqual([["patch", "Deployment", "web", "shop", data, "scale"]]);
    });

    it("createKubernetesResource asks for a namespace for namespaced kinds", async () => {
      const reply = await call("createKubernetesResource", { kind: "Deployment", name: "api", data: {} });

      expect(reply.text).toBe('Kind "Deployment" is namespaced; please provide a namespace to create "api".');
      expect(writes).toEqual([]);
    });

    it("updateKubernetesResource does not write a resource that does not exist", async () => {
      const reply = await call("updateKubernetesResource", {
        kind: "Deployment",
        name: "gone",
        namespace: "shop",
        data: {},
      });

      expect(reply.text).toBe('The Deployment "gone" you want to update does not exist');
      expect(writes).toEqual([]);
    });

    it("deleteKubernetesResource asks for a namespace for namespaced kinds", async () => {
      const reply = await call("deleteKubernetesResource", { kind: "Deployment", name: "web" });

      expect(reply.text).toBe('Kind "Deployment" is namespaced; please provide a namespace to delete "web".');
      expect(writes).toEqual([]);
    });

    it("deleteKubernetesResource uses a normal delete unless a mode is given", async () => {
      expect(
        (await call("deleteKubernetesResource", { kind: "Deployment", name: "web", namespace: "shop" })).text,
      ).toBe('Deployment "web" deleted successfully');
      expect(
        (
          await call("deleteKubernetesResource", {
            kind: "Deployment",
            name: "web",
            namespace: "shop",
            mode: "force_finalize",
          })
        ).text,
      ).toBe('Deployment "web" finalizers cleared successfully');
      expect(writes).toEqual([
        ["remove", "Deployment", "web", "shop", "delete"],
        ["remove", "Deployment", "web", "shop", "force_finalize"],
      ]);
    });

    it("deletePod evicts through the pod API", async () => {
      const reply = await call("deletePod", { name: "web-1", namespace: "shop", mode: "evict" });

      expect(reply).toEqual({ text: 'Pod "web-1" evicted successfully', isError: false });
      expect(writes).toEqual([["deletePod", "web-1", "shop", "evict"]]);
    });

    it("restartKubernetesResource rolls a workload and rejects other kinds by schema", async () => {
      expect(
        (await call("restartKubernetesResource", { kind: "Deployment", name: "web", namespace: "shop" })).text,
      ).toBe('Deployment "web" restarted successfully');
      const rejected = await call("restartKubernetesResource", { kind: "Job", name: "x", namespace: "shop" });

      expect(rejected.isError).toBe(true);
      expect(rejected.text).toMatch(/^Invalid arguments for restartKubernetesResource/);
      expect(writes).toEqual([["restart", "Deployment", "web", "shop"]]);
    });

    it("reports a failed write as an error", async () => {
      const cluster = fakeCluster({
        deletePod: async () => {
          throw {
            reason: "TooManyRequests",
            message: "Cannot evict pod as it would violate the pod's disruption budget.",
          };
        },
      });

      const reply = await call("deletePod", { name: "web-1", namespace: "shop", mode: "evict" }, cluster);

      expect(reply.isError).toBe(true);
      expect(reply.text).toMatch(/^deletePod failed: .*disruption budget/);
    });
  });
});
