import { beforeEach, describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "../../../common/agent-tools";
import { type Cluster, type ClusterResource, createClusterTools, type ResourceApi } from "./cluster-tools";
import { runToolRequest } from "./tool-runner";

const pod = (name: string, namespace: string, phase: string): ClusterResource => ({
  name,
  namespace,
  metadata: { name, namespace, managedFields: [{ manager: "kubectl" }] },
  spec: { containers: [{ name: "app", image: "nginx:1.27" }] },
  status: { phase },
});

const gateway: ClusterResource = {
  name: "public",
  namespace: "infra",
  metadata: { name: "public", namespace: "infra" },
  spec: { gatewayClassName: "istio" },
  status: { conditions: [{ type: "Accepted", status: "True" }] },
};

const node: ClusterResource = { name: "node-1", metadata: { name: "node-1" }, spec: {}, status: {} };

// Every change a tool makes to the fake cluster, in order.
let writes: unknown[][] = [];
beforeEach(() => {
  writes = [];
});

const recordingWrites = (kind: string) => ({
  create: async (...args: unknown[]) => void writes.push(["create", kind, ...args]),
  update: async (...args: unknown[]) => void writes.push(["update", kind, ...args]),
  patch: async (...args: unknown[]) => void writes.push(["patch", kind, ...args]),
  remove: async (...args: unknown[]) => void writes.push(["remove", kind, ...args]),
});

const namespacedApi = (kind: string, items: ClusterResource[]): ResourceApi => ({
  namespaced: true,
  list: async (namespace) => items.filter((item) => !namespace || item.namespace === namespace),
  get: async (name, namespace) => items.find((item) => item.name === name && item.namespace === namespace),
  ...recordingWrites(kind),
});

const twoContainerPod: ClusterResource = {
  name: "api-1",
  namespace: "shop",
  metadata: { name: "api-1", namespace: "shop" },
  spec: { containers: [{ name: "app" }, { name: "sidecar" }] },
};

function fakeCluster(overrides: Partial<Cluster> = {}): Cluster {
  const apis: Record<string, ResourceApi> = {
    "Pod v1": namespacedApi("Pod", [pod("web-1", "shop", "Running"), pod("db-0", "data", "Pending")]),
    "Deployment apps/v1": namespacedApi("Deployment", [
      { name: "web", namespace: "shop", metadata: { name: "web", namespace: "shop" } },
    ]),
    "Gateway gateway.networking.k8s.io/v1": namespacedApi("Gateway", [gateway]),
    "Node v1": {
      namespaced: false,
      list: async (namespace) => (namespace ? [] : [node]),
      get: async (name, namespace) => (name === "node-1" && !namespace ? node : undefined),
      ...recordingWrites("Node"),
    },
  };
  return {
    getVersionInfo: async () => ({ major: "1", minor: "31", gitVersion: "v1.31.2", gitTreeState: "clean" }),
    getNamespaceNames: () => ["default", "shop", "data"],
    getEvents: async (namespace) =>
      namespace === "shop"
        ? [
            {
              type: "Warning",
              reason: "BackOff",
              message: "Back-off restarting failed container",
              action: undefined,
              involvedObject: { kind: "Pod", name: "web-1" },
              source: { component: "kubelet" },
            },
            { type: "Normal", reason: "Pulled", message: "Pulled image" },
          ]
        : [],
    getResourceApi: (kind, apiVersion) =>
      apis[`${kind} ${apiVersion}`] ?? `No API serves kind "${kind}" at "${apiVersion}".`,
    deletePod: async (...args) => void writes.push(["deletePod", ...args]),
    restartWorkload: async (...args) => void writes.push(["restart", ...args]),
    getPodLogs: async (name, _namespace, query) =>
      `${name}/${query.container} tail=${query.tailLines}\nINFO started\nERROR failed to connect\n`,
    podLogsTailLines: () => 500,
    ...overrides,
  };
}

const call = (toolName: string, args: Record<string, unknown> = {}, cluster = fakeCluster()) =>
  runToolRequest({ requestId: "r1", toolName, args }, createClusterTools(cluster));

describe("cluster tools", () => {
  it("has a frame implementation for every shared read tool", () => {
    expect(Object.keys(createClusterTools(fakeCluster())).sort()).toEqual(AGENT_TOOLS.map((t) => t.name).sort());
  });

  it("getClusterVersion summarizes the server version", async () => {
    expect(await call("getClusterVersion")).toEqual({
      text: '{"version":"v1.31.2","major":"1","minor":"31"}',
      isError: false,
    });
  });

  it("getNamespaces lists the namespace names", async () => {
    expect(await call("getNamespaces")).toEqual({ text: '["default","shop","data"]', isError: false });
  });

  it("getWarningEventsByNamespace returns only warning events", async () => {
    const reply = await call("getWarningEventsByNamespace", { namespace: "shop" });

    expect(reply.isError).toBe(false);
    expect(JSON.parse(reply.text)).toEqual([
      {
        event: {
          type: "Warning",
          reason: "BackOff",
          message: "Back-off restarting failed container",
          involvedObject: { kind: "Pod", name: "web-1" },
          source: { component: "kubelet" },
        },
      },
    ]);
  });

  it("listKubernetesResources scopes to a namespace and strips managedFields", async () => {
    const reply = await call("listKubernetesResources", { kind: "Pod", namespace: "shop" });

    expect(JSON.parse(reply.text)).toEqual([
      {
        name: "web-1",
        namespace: "shop",
        spec: { containers: [{ name: "app", image: "nginx:1.27" }] },
        status: { phase: "Running" },
        metadata: { name: "web-1", namespace: "shop" },
      },
    ]);
  });

  it("listKubernetesResources trims each resource to the selected fields", async () => {
    const reply = await call("listKubernetesResources", { kind: "Pod", fields: [".name", ".status.phase"] });

    expect(JSON.parse(reply.text)).toEqual([
      { name: "web-1", status: { phase: "Running" } },
      { name: "db-0", status: { phase: "Pending" } },
    ]);
  });

  it("listKubernetesResources ignores the namespace for cluster-scoped kinds", async () => {
    const reply = await call("listKubernetesResources", { kind: "Node", apiVersion: "v1", namespace: "shop" });

    expect(JSON.parse(reply.text).map((item: ClusterResource) => item.name)).toEqual(["node-1"]);
  });

  it("listKubernetesResources reaches a CRD with an irregular plural through discovery", async () => {
    const reply = await call("listKubernetesResources", {
      kind: "Gateway",
      apiVersion: "gateway.networking.k8s.io/v1",
      fields: [".name", ".spec.gatewayClassName"],
    });

    expect(reply).toEqual({ text: '[{"name":"public","spec":{"gatewayClassName":"istio"}}]', isError: false });
  });

  it("asks for an apiVersion when the kind has no default", async () => {
    const reply = await call("listKubernetesResources", { kind: "Gateway" });

    expect(reply.text).toBe(
      'Could not resolve the apiVersion for kind "Gateway". Provide an explicit apiVersion (for example "apps/v1").',
    );
  });

  it("passes on discovery's answer when no API serves the kind", async () => {
    const reply = await call("listKubernetesResources", { kind: "Widget", apiVersion: "example.com/v1" });

    expect(reply.text).toBe('No API serves kind "Widget" at "example.com/v1".');
  });

  it("listKubernetesResources rejects a malformed field selector", async () => {
    const reply = await call("listKubernetesResources", { kind: "Pod", fields: ["spec[oops"] });

    expect(reply.text).toBe('Invalid field selector "spec[oops": unterminated "[".');
  });

  it("getKubernetesResource returns one resource, keeping managedFields on request", async () => {
    const reply = await call("getKubernetesResource", {
      kind: "Pod",
      name: "web-1",
      namespace: "shop",
      includeManagedFields: true,
      fields: [".metadata.managedFields"],
    });

    expect(reply).toEqual({ text: '{"metadata":{"managedFields":[{"manager":"kubectl"}]}}', isError: false });
  });

  it("getKubernetesResource asks for a namespace for namespaced kinds", async () => {
    const reply = await call("getKubernetesResource", { kind: "Pod", name: "web-1" });

    expect(reply.text).toBe('Kind "Pod" is namespaced; please provide a namespace to get "web-1".');
  });

  it("getKubernetesResource reads cluster-scoped kinds without a namespace", async () => {
    const reply = await call("getKubernetesResource", {
      kind: "Node",
      apiVersion: "v1",
      name: "node-1",
      fields: [".name"],
    });

    expect(reply.text).toBe('{"name":"node-1"}');
  });

  it("getKubernetesResource reports a missing resource", async () => {
    const reply = await call("getKubernetesResource", { kind: "Pod", name: "gone", namespace: "shop" });

    expect(reply.text).toBe('The Pod "gone" was not found.');
  });

  it("rejects arguments that do not match the shared schema", async () => {
    const reply = await call("getWarningEventsByNamespace", {});

    expect(reply.isError).toBe(true);
    expect(reply.text).toMatch(/^Invalid arguments for getWarningEventsByNamespace: .*namespace/);
  });

  it("reports a missing event store as an error, not as 'no warnings'", async () => {
    const cluster = fakeCluster({
      getEvents: async () => {
        throw new Error("The event store is not available in this cluster window.");
      },
    });

    expect(await call("getWarningEventsByNamespace", { namespace: "shop" }, cluster)).toEqual({
      text: "getWarningEventsByNamespace failed: The event store is not available in this cluster window.",
      isError: true,
    });
  });

  it("describes a non-Error failure instead of '[object Object]'", async () => {
    const cluster = fakeCluster({
      getVersionInfo: async () => {
        throw { reason: "Forbidden", code: 403 };
      },
    });

    expect(await call("getClusterVersion", {}, cluster)).toEqual({
      text: 'getClusterVersion failed: {"reason":"Forbidden","code":403}',
      isError: true,
    });
  });

  it("turns a failing cluster call into an error reply", async () => {
    const cluster = fakeCluster({
      getResourceApi: () => ({
        namespaced: true,
        list: async () => {
          throw new Error("the server is currently unable to handle the request");
        },
        get: async () => undefined,
        ...recordingWrites("Pod"),
      }),
    });

    expect(await call("listKubernetesResources", { kind: "Pod" }, cluster)).toEqual({
      text: "listKubernetesResources failed: the server is currently unable to handle the request",
      isError: true,
    });
  });

  it("replies 'Cluster not connected' when the cluster is disconnected", async () => {
    const reply = await runToolRequest(
      { requestId: "r1", toolName: "getNamespaces", args: {} },
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

  describe("getPodLogs", () => {
    it("reads a single-container pod's logs with the preference's tail length", async () => {
      const reply = await call("getPodLogs", { name: "web-1", namespace: "shop" });

      expect(reply).toEqual({
        text: "web-1/app tail=500\nINFO started\nERROR failed to connect\n",
        isError: false,
      });
    });

    it("lists the containers of a multi-container pod when none is chosen", async () => {
      const cluster = fakeCluster({ getResourceApi: () => namespacedApi("Pod", [twoContainerPod]) });
      const reply = await call("getPodLogs", { name: "api-1", namespace: "shop" }, cluster);

      expect(reply.isError).toBe(false);
      expect(reply.text).toContain("app");
      expect(reply.text).toContain("sidecar");
      expect(reply.text).not.toContain("tail=");
    });

    it("keeps only the lines matching the filter", async () => {
      const reply = await call("getPodLogs", { name: "web-1", namespace: "shop", filter: "ERROR" });

      expect(reply.text).toBe("ERROR failed to connect\n");
    });

    it("reports a pod that does not exist", async () => {
      const reply = await call("getPodLogs", { name: "gone", namespace: "shop" });

      expect(reply.text).toBe('The Pod "gone" was not found in namespace "shop".');
    });

    it("treats a missing previous container as no previous logs, not as an error", async () => {
      const cluster = fakeCluster({
        getPodLogs: async () => {
          throw new Error('previous terminated container "app" in pod "web-1" not found');
        },
      });

      const reply = await call("getPodLogs", { name: "web-1", namespace: "shop", previous: true }, cluster);

      expect(reply.isError).toBe(false);
      expect(reply.text).toMatch(/previous/i);
    });
  });
});
