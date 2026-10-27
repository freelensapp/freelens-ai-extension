import { beforeEach, describe, expect, it } from "vitest";
import { createFakeKubeJsonApi } from "../../../../test/kube-json-api";
import { READ_TOOL_RUNNERS } from "./read-tools";

const WEB = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "shop", managedFields: [{ manager: "kubectl" }] },
  spec: { replicas: 2, template: { spec: { containers: [{ name: "web", image: "nginx:1.27" }] } } },
  status: { readyReplicas: 2 },
};

const POD = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: { name: "web-1", namespace: "shop" },
  spec: { containers: [{ name: "app", image: "nginx:1.27" }] },
  status: { phase: "Running" },
};

const NODE = { apiVersion: "v1", kind: "Node", metadata: { name: "node-1" }, spec: {}, status: {} };

const INGRESS = {
  apiVersion: "networking.k8s.io/v1",
  kind: "Ingress",
  metadata: { name: "shop", namespace: "shop" },
  spec: { ingressClassName: "nginx" },
};

const KUSTOMIZATION = {
  apiVersion: "kustomize.toolkit.fluxcd.io/v1",
  kind: "Kustomization",
  metadata: { name: "apps", namespace: "flux-system" },
  spec: { path: "./apps" },
};

let cluster: ReturnType<typeof createFakeKubeJsonApi>;

beforeEach(() => {
  cluster = createFakeKubeJsonApi({
    "/version": { major: "1", minor: "31", gitVersion: "v1.31.2", gitTreeState: "clean", platform: "linux/amd64" },
    "/api/v1/namespaces": { items: [{ metadata: { name: "default" } }, { metadata: { name: "shop" } }] },
    "/api/v1/namespaces/shop/events": {
      items: [
        {
          type: "Warning",
          reason: "BackOff",
          message: "Back-off restarting failed container",
          involvedObject: { kind: "Pod", name: "web-1" },
          source: { component: "kubelet" },
          metadata: { name: "web-1.1" },
        },
        { type: "Normal", reason: "Pulled", message: "Pulled image" },
      ],
    },
    "/api/v1/pods": { items: [POD] },
    "/api/v1/namespaces/shop/pods": { items: [POD] },
    "/api/v1/namespaces/shop/pods/web-1": POD,
    "/api/v1/nodes": { items: [NODE] },
    "/api/v1/nodes/node-1": NODE,
    "/apis/apps/v1/namespaces/shop/deployments/web": WEB,
    "/apis/networking.k8s.io/v1/namespaces/shop/ingresses": { items: [INGRESS] },
    "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations": { items: [KUSTOMIZATION] },
  });
});

const run = (toolName: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => {
  const runner = READ_TOOL_RUNNERS[toolName];
  if (!runner) throw new Error(`No runner for ${toolName}`);
  return runner(args, { api: cluster.api, signal, podLogsTailLines: 500 });
};

describe("read tools", () => {
  it("getClusterVersion reads /version and summarizes it", async () => {
    expect(await run("getClusterVersion")).toBe(
      '{"version":"v1.31.2","major":"1","minor":"31","platform":"linux/amd64"}',
    );
    expect(cluster.requests).toEqual([expect.objectContaining({ method: "get", path: "/version" })]);
  });

  it("getNamespaces lists the names from the namespace list", async () => {
    expect(await run("getNamespaces")).toBe('["default","shop"]');
    expect(cluster.requests).toEqual([expect.objectContaining({ method: "get", path: "/api/v1/namespaces" })]);
  });

  it("getWarningEventsByNamespace asks for the warning events of the namespace and keeps only warnings", async () => {
    const result = await run("getWarningEventsByNamespace", { namespace: "shop" });

    expect(cluster.requests).toEqual([
      expect.objectContaining({
        method: "get",
        path: "/api/v1/namespaces/shop/events",
        query: { fieldSelector: "type=Warning" },
      }),
    ]);
    expect(JSON.parse(result)).toEqual([
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

  it("listKubernetesResources lists a built-in kind in a namespace and strips managedFields", async () => {
    const result = await run("listKubernetesResources", { kind: "Pod", namespace: "shop" });

    expect(cluster.requests.map(({ path }) => path)).toEqual(["/api/v1", "/api/v1/namespaces/shop/pods"]);
    expect(JSON.parse(result)).toEqual([
      {
        name: "web-1",
        namespace: "shop",
        spec: { containers: [{ name: "app", image: "nginx:1.27" }] },
        status: { phase: "Running" },
        metadata: { name: "web-1", namespace: "shop" },
      },
    ]);
  });

  it("listKubernetesResources lists a namespaced kind across all namespaces without a namespace", async () => {
    await run("listKubernetesResources", { kind: "Pod" });

    expect(cluster.actions().map(({ path }) => path)).toEqual(["/api/v1/pods"]);
  });

  it("listKubernetesResources ignores the namespace for a cluster-scoped kind", async () => {
    const result = await run("listKubernetesResources", { kind: "Node", apiVersion: "v1", namespace: "shop" });

    expect(cluster.actions().map(({ path }) => path)).toEqual(["/api/v1/nodes"]);
    expect(JSON.parse(result).map((item: { name: string }) => item.name)).toEqual(["node-1"]);
  });

  it("listKubernetesResources finds an irregular plural in discovery, skipping the subresources", async () => {
    const result = await run("listKubernetesResources", {
      kind: "Ingress",
      apiVersion: "networking.k8s.io/v1",
      namespace: "shop",
      fields: [".name", ".spec.ingressClassName"],
    });

    expect(cluster.requests.map(({ path }) => path)).toEqual([
      "/apis/networking.k8s.io/v1",
      "/apis/networking.k8s.io/v1/namespaces/shop/ingresses",
    ]);
    expect(result).toBe('[{"name":"shop","spec":{"ingressClassName":"nginx"}}]');
  });

  it("listKubernetesResources reaches a custom resource through its group's discovery", async () => {
    const result = await run("listKubernetesResources", {
      kind: "Kustomization",
      apiVersion: "kustomize.toolkit.fluxcd.io/v1",
      namespace: "flux-system",
    });

    expect(cluster.requests.map(({ path }) => path)).toEqual([
      "/apis/kustomize.toolkit.fluxcd.io/v1",
      "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations",
    ]);
    expect(JSON.parse(result)).toEqual([expect.objectContaining({ name: "apps", namespace: "flux-system" })]);
  });

  it("fetches the discovery document on every call", async () => {
    await run("listKubernetesResources", { kind: "Pod", namespace: "shop" });
    await run("listKubernetesResources", { kind: "Pod", namespace: "shop" });

    expect(cluster.requests.filter(({ path }) => path === "/api/v1")).toHaveLength(2);
  });

  it("asks for an apiVersion when the kind has no default, without a request", async () => {
    expect(await run("listKubernetesResources", { kind: "Gateway" })).toBe(
      'Could not resolve the apiVersion for kind "Gateway". Provide an explicit apiVersion (for example "apps/v1").',
    );
    expect(cluster.requests).toEqual([]);
  });

  it("answers a kind the cluster does not serve with a message for the model", async () => {
    expect(await run("listKubernetesResources", { kind: "Widget", apiVersion: "example.com/v1" })).toBe(
      'Could not resolve a Kubernetes API for kind "Widget" and apiVersion "example.com/v1".',
    );
    expect(await run("listKubernetesResources", { kind: "Gateway", apiVersion: "apps/v1" })).toBe(
      'Could not resolve a Kubernetes API for kind "Gateway" and apiVersion "apps/v1".',
    );
  });

  it("listKubernetesResources rejects a malformed field selector", async () => {
    expect(await run("listKubernetesResources", { kind: "Pod", fields: ["spec[oops"] })).toBe(
      'Invalid field selector "spec[oops": unterminated "[".',
    );
  });

  it("getKubernetesResource gets one object, keeping managedFields on request", async () => {
    const stripped = JSON.parse(
      await run("getKubernetesResource", { kind: "Deployment", name: "web", namespace: "shop" }),
    );
    const kept = await run("getKubernetesResource", {
      kind: "Deployment",
      name: "web",
      namespace: "shop",
      includeManagedFields: true,
      fields: [".metadata.managedFields"],
    });

    expect(stripped.metadata.managedFields).toBeUndefined();
    expect(stripped.spec.replicas).toBe(2);
    expect(kept).toBe('{"metadata":{"managedFields":[{"manager":"kubectl"}]}}');
  });

  it("getKubernetesResource asks for a namespace for a namespaced kind", async () => {
    expect(await run("getKubernetesResource", { kind: "Pod", name: "web-1" })).toBe(
      'Kind "Pod" is namespaced; please provide a namespace to get "web-1".',
    );
    expect(cluster.actions()).toEqual([]);
  });

  it("getKubernetesResource reads a cluster-scoped kind without a namespace", async () => {
    expect(
      await run("getKubernetesResource", { kind: "Node", apiVersion: "v1", name: "node-1", fields: [".name"] }),
    ).toBe('{"name":"node-1"}');
    expect(cluster.actions().map(({ path }) => path)).toEqual(["/api/v1/nodes/node-1"]);
  });

  it("getKubernetesResource rejects with the client's error for a missing object", async () => {
    await expect(run("getKubernetesResource", { kind: "Pod", name: "gone", namespace: "shop" })).rejects.toMatchObject({
      isUsedForNotification: false,
    });
  });

  describe("getPodLogs", () => {
    const LOG_PATH = "/api/v1/namespaces/shop/pods/web-1/log";
    const withLogs = (answer: { status: number; text: string }, objects: Record<string, unknown> = {}) => {
      cluster = createFakeKubeJsonApi(
        { "/api/v1/namespaces/shop/pods/web-1": POD, ...objects },
        {
          logs: { [LOG_PATH]: answer },
        },
      );
    };
    const logRequest = () => cluster.requests.find(({ method }) => method === "getResponse");

    beforeEach(() => {
      withLogs({ status: 200, text: '{"level":"info","msg":"started"}\nERROR failed to connect\n' });
    });

    it("reads the log subresource as raw text with the preference's tail lines", async () => {
      const result = await run("getPodLogs", { name: "web-1", namespace: "shop" });

      expect(result).toBe('{"level":"info","msg":"started"}\nERROR failed to connect\n');
      expect(logRequest()).toMatchObject({ method: "getResponse", path: LOG_PATH });
    });

    it("puts only the parameters that are set into the query, never an empty value", async () => {
      await run("getPodLogs", { name: "web-1", namespace: "shop" });

      expect(logRequest()?.query).toStrictEqual({ container: "app", tailLines: 500 });
    });

    it("asks for the previous instance and timestamps only when told to", async () => {
      await run("getPodLogs", { name: "web-1", namespace: "shop", previous: true, timestamps: true, tailLines: 20 });

      expect(logRequest()?.query).toStrictEqual({ container: "app", tailLines: 20, timestamps: true, previous: true });
    });

    it("lists the containers of a multi-container pod when none is chosen, without reading logs", async () => {
      withLogs(
        { status: 200, text: "x" },
        {
          "/api/v1/namespaces/shop/pods/web-1": {
            ...POD,
            spec: { containers: [{ name: "app" }, { name: "sidecar" }] },
          },
        },
      );

      const result = await run("getPodLogs", { name: "web-1", namespace: "shop" });

      expect(result).toBe(
        "The pod has multiple containers; specify which one to read. Available containers: app, sidecar.",
      );
      expect(logRequest()).toBeUndefined();
    });

    it("keeps only the lines matching the filter", async () => {
      expect(await run("getPodLogs", { name: "web-1", namespace: "shop", filter: "ERROR" })).toBe(
        "ERROR failed to connect\n",
      );
    });

    it("reports an invalid filter before any request", async () => {
      expect(await run("getPodLogs", { name: "web-1", namespace: "shop", filter: "(" })).toMatch(
        /^Invalid filter regular expression "\(":/,
      );
      expect(cluster.requests).toEqual([]);
    });

    it("answers empty logs with a hint instead of an empty result", async () => {
      withLogs({ status: 200, text: "" });

      expect(await run("getPodLogs", { name: "web-1", namespace: "shop" })).toBe(
        'No logs for container "app" in pod "web-1". The container may not have started yet; try previous: true to read the last terminated instance.',
      );
    });

    it("treats a missing previous container as no previous logs, not as an error", async () => {
      withLogs({
        status: 400,
        text: JSON.stringify({
          kind: "Status",
          code: 400,
          message: 'previous terminated container "app" in pod "web-1" not found',
        }),
      });

      expect(await run("getPodLogs", { name: "web-1", namespace: "shop", previous: true })).toBe(
        'No previous logs for container "app" in pod "web-1". The container may not have a terminated instance.',
      );
    });

    it("rejects with the API server's Status for any other failed read", async () => {
      withLogs({ status: 403, text: JSON.stringify({ kind: "Status", code: 403, message: "pods is forbidden" }) });

      await expect(run("getPodLogs", { name: "web-1", namespace: "shop" })).rejects.toMatchObject({
        code: 403,
        message: "pods is forbidden",
      });
    });

    it("rejects with the client's error when the pod does not exist", async () => {
      await expect(run("getPodLogs", { name: "gone", namespace: "shop" })).rejects.toMatchObject({
        isUsedForNotification: false,
      });
    });
  });

  it("hands the tool call's signal to every request", async () => {
    const controller = new AbortController();

    await run("getKubernetesResource", { kind: "Deployment", name: "web", namespace: "shop" }, controller.signal);

    expect(cluster.requests.map(({ path }) => path)).toEqual([
      "/apis/apps/v1",
      "/apis/apps/v1/namespaces/shop/deployments/web",
    ]);
    expect(cluster.requests.every(({ signal }) => signal === controller.signal)).toBe(true);
  });
});
