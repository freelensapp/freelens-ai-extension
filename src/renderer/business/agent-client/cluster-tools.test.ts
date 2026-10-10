import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "../../../common/agent-tools";
import { type ClusterReader, type ClusterResource, createClusterTools, type ResourceApi } from "./cluster-tools";
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

const namespacedApi = (items: ClusterResource[]): ResourceApi => ({
  namespaced: true,
  list: async (namespace) => items.filter((item) => !namespace || item.namespace === namespace),
  get: async (name, namespace) => items.find((item) => item.name === name && item.namespace === namespace),
});

function fakeCluster(overrides: Partial<ClusterReader> = {}): ClusterReader {
  const apis: Record<string, ResourceApi> = {
    "Pod v1": namespacedApi([pod("web-1", "shop", "Running"), pod("db-0", "data", "Pending")]),
    "Gateway gateway.networking.k8s.io/v1": namespacedApi([gateway]),
    "Node v1": {
      namespaced: false,
      list: async (namespace) => (namespace ? [] : [node]),
      get: async (name, namespace) => (name === "node-1" && !namespace ? node : undefined),
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
  });
});
