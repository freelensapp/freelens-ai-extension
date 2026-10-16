import { Main } from "@freelensapp/extensions";
import { interrupt } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeKubeJsonApi, DELETED_AT, installFakeClusters } from "../../../../test/kube-json-api";
import { PreferencesStore } from "../../../common/store";
import {
  createKubernetesResource,
  deleteKubernetesResource,
  deletePod,
  getClusterVersion,
  getKubernetesResource,
  getNamespaces,
  getPodLogs,
  getWarningEventsByNamespace,
  listKubernetesResources,
  patchKubernetesResource,
  restartKubernetesResource,
  updateKubernetesResource,
} from "./tools";

// The approval gate is LangGraph's `interrupt()`, which needs a running graph;
// here it answers at once. The gate inside a real graph is covered by
// approval-gate.test.ts.
vi.mock("@langchain/langgraph", () => ({ interrupt: vi.fn(() => "yes") }));

const config = (clusterId?: string) => ({ configurable: { clusterId } });

const WEB = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "default", managedFields: [{ manager: "kubectl" }] },
  spec: { replicas: 2, template: { spec: { containers: [{ name: "web", image: "nginx:1.27" }] } } },
  status: { readyReplicas: 2 },
};

const POD = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: { name: "web-1", namespace: "default" },
  spec: { containers: [{ name: "web" }] },
};

const FINALIZER_POD_PATH = "/api/v1/namespaces/default/pods/finalizer-pod";

const FINALIZER_POD = {
  apiVersion: "v1",
  kind: "Pod",
  metadata: { name: "finalizer-pod", namespace: "default", uid: "uid-1", finalizers: ["freelens.app/ai-check"] },
  spec: { containers: [{ name: "app" }] },
};

const KUSTOMIZATION = {
  apiVersion: "kustomize.toolkit.fluxcd.io/v1",
  kind: "Kustomization",
  metadata: { name: "apps", namespace: "flux-system" },
  spec: { path: "./apps" },
};

let cluster: ReturnType<typeof createFakeKubeJsonApi>;
let other: ReturnType<typeof createFakeKubeJsonApi>;

beforeEach(() => {
  vi.mocked(interrupt).mockReset().mockReturnValue("yes");
  PreferencesStore.resetInstance();
  cluster = createFakeKubeJsonApi(
    {
      "/apis/apps/v1/namespaces/default/deployments/web": WEB,
      "/apis/apps/v1/deployments": { items: [WEB] },
      "/api/v1/namespaces/default/pods/web-1": POD,
      [FINALIZER_POD_PATH]: FINALIZER_POD,
      "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations": { items: [KUSTOMIZATION] },
      "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations/apps": KUSTOMIZATION,
      "/api/v1/namespaces": { items: [{ metadata: { name: "default" } }, { metadata: { name: "flux-system" } }] },
      "/version": { major: "1", minor: "35", gitVersion: "v1.35.0", platform: "linux/amd64" },
      "/api/v1/namespaces/default/events": {
        items: [
          { type: "Warning", reason: "BackOff", message: "Back-off restarting", involvedObject: { name: "web-1" } },
          { type: "Normal", reason: "Pulled", message: "Pulled image" },
        ],
      },
    },
    {
      logs: {
        "/api/v1/namespaces/default/pods/web-1/log": { status: 200, text: '{"level":"info","msg":"started"}\n' },
      },
    },
  );
  other = createFakeKubeJsonApi();
  installFakeClusters({ "cluster-a": cluster, "cluster-b": other });
});

describe("the cluster of a run", () => {
  it("refuses a run without a cluster and sends no request", async () => {
    const result = await getNamespaces.invoke({}, config());

    expect(result).toBe("No cluster is selected for this chat.");
    expect(Main.K8sApi.KubeJsonApi.forCluster).not.toHaveBeenCalled();
  });

  it("refuses a cluster Freelens does not know", async () => {
    const result = await getNamespaces.invoke({}, config("cluster-x"));

    expect(result).toBe('The cluster "cluster-x" of this chat is not known to Freelens.');
    expect(Main.K8sApi.KubeJsonApi.forCluster).not.toHaveBeenCalled();
  });

  it("sends the requests to the cluster named in the run config", async () => {
    await getNamespaces.invoke({}, config("cluster-a"));

    expect(Main.K8sApi.KubeJsonApi.forCluster).toHaveBeenLastCalledWith("cluster-a");
    expect(cluster.requests.map(({ path }) => path)).toEqual(["/api/v1/namespaces"]);
    expect(other.requests).toEqual([]);
  });
});

describe("the read tools", () => {
  it("lists the namespaces", async () => {
    expect(await getNamespaces.invoke({}, config("cluster-a"))).toEqual(["default", "flux-system"]);
  });

  it("reads the version from /version", async () => {
    const result = JSON.parse(await getClusterVersion.invoke({}, config("cluster-a")));

    expect(cluster.requests).toEqual([expect.objectContaining({ method: "get", path: "/version" })]);
    expect(result).toMatchObject({ version: "v1.35.0" });
  });

  it("asks for the warning events of a namespace and keeps only warnings", async () => {
    const result = JSON.parse(await getWarningEventsByNamespace.invoke({ namespace: "default" }, config("cluster-a")));

    expect(cluster.requests).toEqual([
      expect.objectContaining({ path: "/api/v1/namespaces/default/events", query: { fieldSelector: "type=Warning" } }),
    ]);
    expect(result).toEqual([
      {
        event: expect.objectContaining({ type: "Warning", reason: "BackOff", involvedObject: { name: "web-1" } }),
      },
    ]);
  });

  it("resolves a custom resource from discovery and lists it in a namespace", async () => {
    const result = JSON.parse(
      await listKubernetesResources.invoke(
        { kind: "Kustomization", apiVersion: "kustomize.toolkit.fluxcd.io/v1", namespace: "flux-system" },
        config("cluster-a"),
      ),
    );

    expect(cluster.requests.map(({ path }) => path)).toEqual([
      "/apis/kustomize.toolkit.fluxcd.io/v1",
      "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations",
    ]);
    expect(result).toEqual([expect.objectContaining({ name: "apps", namespace: "flux-system" })]);
  });

  it("lists a namespaced kind across all namespaces without a namespace", async () => {
    await listKubernetesResources.invoke({ kind: "Deployment" }, config("cluster-a"));

    expect(cluster.actions().map(({ path }) => path)).toEqual(["/apis/apps/v1/deployments"]);
  });

  it("gets one object, strips the managed fields and applies the field selectors", async () => {
    const full = JSON.parse(
      await getKubernetesResource.invoke(
        { kind: "Deployment", name: "web", namespace: "default" },
        config("cluster-a"),
      ),
    );
    const selected = JSON.parse(
      await getKubernetesResource.invoke(
        { kind: "Deployment", name: "web", namespace: "default", fields: [".spec.replicas"] },
        config("cluster-a"),
      ),
    );

    expect(full.metadata.managedFields).toBeUndefined();
    expect(full.spec.replicas).toBe(2);
    expect(selected).toEqual({ spec: { replicas: 2 } });
  });

  it("answers a kind the cluster does not serve with a message for the model", async () => {
    const result = await getKubernetesResource.invoke(
      { kind: "Widget", apiVersion: "example.com/v1", name: "w", namespace: "default" },
      config("cluster-a"),
    );

    expect(result).toBe('Could not resolve a Kubernetes API for kind "Widget" and apiVersion "example.com/v1".');
  });

  it("reads the pod logs as text, also when a line is valid JSON", async () => {
    PreferencesStore.getInstanceOrCreate<PreferencesStore>().podLogsRequireApproval = false;

    const result = await getPodLogs.invoke({ name: "web-1", namespace: "default", tailLines: 50 }, config("cluster-a"));

    expect(interrupt).not.toHaveBeenCalled();
    expect(cluster.requests.at(-1)).toMatchObject({
      method: "getResponse",
      path: "/api/v1/namespaces/default/pods/web-1/log",
      query: { container: "web", tailLines: 50 },
    });
    expect(result).toContain('{"level":"info","msg":"started"}');
  });

  it("asks for approval before reading the logs when the preference says so", async () => {
    vi.mocked(interrupt).mockReturnValue("no");

    const result = await getPodLogs.invoke({ name: "web-1", namespace: "default" }, config("cluster-a"));

    expect(interrupt).toHaveBeenCalledOnce();
    expect(result).toBe("The user denied the action");
    expect(cluster.requests.some(({ method }) => method === "getResponse")).toBe(false);
  });
});

describe("the write tools", () => {
  it("creates an object with its kind, apiVersion, name and namespace set", async () => {
    await createKubernetesResource.invoke(
      {
        kind: "Kustomization",
        apiVersion: "kustomize.toolkit.fluxcd.io/v1",
        namespace: "flux-system",
        data: { metadata: { name: "infra" }, spec: { path: "./infra" } },
      },
      config("cluster-a"),
    );

    expect(cluster.actions()).toEqual([
      expect.objectContaining({
        method: "post",
        path: "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations",
        data: {
          kind: "Kustomization",
          apiVersion: "kustomize.toolkit.fluxcd.io/v1",
          metadata: { name: "infra", namespace: "flux-system" },
          spec: { path: "./infra" },
        },
      }),
    ]);
  });

  it("sends nothing when the user denies the action", async () => {
    vi.mocked(interrupt).mockReturnValue("no");

    const result = await createKubernetesResource.invoke(
      {
        kind: "Kustomization",
        apiVersion: "kustomize.toolkit.fluxcd.io/v1",
        namespace: "flux-system",
        data: { metadata: { name: "infra" } },
      },
      config("cluster-a"),
    );

    expect(result).toBe("The user denied the action");
    expect(cluster.actions()).toEqual([]);
  });

  it("shows the current object as the backup in the approval request", async () => {
    await updateKubernetesResource.invoke(
      {
        kind: "Kustomization",
        apiVersion: "kustomize.toolkit.fluxcd.io/v1",
        name: "apps",
        namespace: "flux-system",
        data: { ...KUSTOMIZATION, spec: { path: "./apps/production" } },
      },
      config("cluster-a"),
    );

    const request = vi.mocked(interrupt).mock.calls[0]?.[0] as { resourcesString?: string; actionToApprove: object };
    expect(request.actionToApprove).toMatchObject({ action: "UPDATE KUSTOMIZATION", name: "apps" });
    expect(request.resourcesString).toContain("path: ./apps\n");
  });

  it("updates with a PUT of the object", async () => {
    await updateKubernetesResource.invoke(
      {
        kind: "Kustomization",
        apiVersion: "kustomize.toolkit.fluxcd.io/v1",
        name: "apps",
        namespace: "flux-system",
        data: { ...KUSTOMIZATION, spec: { path: "./apps/production" } },
      },
      config("cluster-a"),
    );

    const put = cluster.actions().find(({ method }) => method === "put");
    expect(put).toMatchObject({
      path: "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations/apps",
      data: { spec: { path: "./apps/production" }, metadata: { name: "apps", namespace: "flux-system" } },
    });
  });

  it("patches with a merge patch", async () => {
    await patchKubernetesResource.invoke(
      { kind: "Deployment", name: "web", namespace: "default", data: { metadata: { labels: { tier: "web" } } } },
      config("cluster-a"),
    );

    expect(cluster.actions().at(-1)).toEqual({
      method: "patch",
      path: "/apis/apps/v1/namespaces/default/deployments/web",
      data: { metadata: { labels: { tier: "web" } } },
      query: undefined,
      headers: { "content-type": "application/merge-patch+json" },
    });
  });

  it("patches a subresource with a strategic merge patch", async () => {
    await patchKubernetesResource.invoke(
      { kind: "Deployment", name: "web", namespace: "default", subresource: "scale", data: { spec: { replicas: 5 } } },
      config("cluster-a"),
    );

    expect(cluster.actions().at(-1)).toMatchObject({
      method: "patch",
      path: "/apis/apps/v1/namespaces/default/deployments/web/scale",
      data: { spec: { replicas: 5 } },
      headers: { "content-type": "application/strategic-merge-patch+json" },
    });
  });

  it.each([
    ["delete", { method: "del", query: { propagationPolicy: "Background" }, data: undefined }],
    [
      "force_delete",
      {
        method: "del",
        query: { propagationPolicy: "Background" },
        data: { kind: "DeleteOptions", apiVersion: "v1", gracePeriodSeconds: 0, propagationPolicy: "Background" },
      },
    ],
    [
      "force_finalize",
      {
        method: "patch",
        data: { metadata: { finalizers: [] } },
        headers: { "content-type": "application/merge-patch+json" },
      },
    ],
  ] as const)("deletes in the %s mode", async (mode, expected) => {
    await deleteKubernetesResource.invoke(
      { kind: "Deployment", name: "web", namespace: "default", mode },
      config("cluster-a"),
    );

    expect(cluster.actions().at(-1)).toMatchObject({
      path: "/apis/apps/v1/namespaces/default/deployments/web",
      ...expected,
    });
  });

  it("evicts a pod through its eviction subresource", async () => {
    await deletePod.invoke({ name: "web-1", namespace: "default", mode: "evict" }, config("cluster-a"));

    expect(cluster.actions().at(-1)).toMatchObject({
      method: "post",
      path: "/api/v1/namespaces/default/pods/web-1/eviction",
      data: { apiVersion: "policy/v1", kind: "Eviction", metadata: { name: "web-1", namespace: "default" } },
    });
  });

  describe("deleting a pod with its finalizers", () => {
    const deleteWithFinalizers = () =>
      deletePod.invoke(
        { name: "finalizer-pod", namespace: "default", mode: "delete_with_finalizers" },
        config("cluster-a"),
      );

    const writes = () => cluster.actions().filter(({ method }) => method !== "get");

    it("removes the finalizers with a JSON merge patch, then force deletes the pod", async () => {
      const result = await deleteWithFinalizers();

      expect(writes()).toEqual([
        {
          method: "patch",
          path: FINALIZER_POD_PATH,
          data: { metadata: { finalizers: null } },
          query: undefined,
          headers: { "content-type": "application/merge-patch+json" },
        },
        expect.objectContaining({
          method: "del",
          path: FINALIZER_POD_PATH,
          data: expect.objectContaining({ gracePeriodSeconds: 0 }),
        }),
      ]);
      expect(cluster.objects).not.toHaveProperty(FINALIZER_POD_PATH);
      expect(result).toBe('Pod "finalizer-pod" deleted and finalizers cleared successfully');
    });

    it("reports a pod in Terminating as deleted when it is gone before the force delete", async () => {
      (cluster.objects[FINALIZER_POD_PATH] as { metadata: Record<string, unknown> }).metadata.deletionTimestamp =
        DELETED_AT;

      const result = await deleteWithFinalizers();

      expect(writes().map(({ method }) => method)).toEqual(["patch", "del"]);
      expect(cluster.objects).not.toHaveProperty(FINALIZER_POD_PATH);
      expect(result).toBe('Pod "finalizer-pod" deleted and finalizers cleared successfully');
    });
  });

  it("restarts a workload with the restartedAt annotation of its pod template", async () => {
    await restartKubernetesResource.invoke(
      { kind: "Deployment", name: "web", namespace: "default" },
      config("cluster-a"),
    );

    const patch = cluster.actions().at(-1);
    expect(patch).toMatchObject({
      method: "patch",
      path: "/apis/apps/v1/namespaces/default/deployments/web",
      headers: { "content-type": "application/strategic-merge-patch+json" },
    });
    const annotations = (patch?.data as { spec: { template: { metadata: { annotations: Record<string, string> } } } })
      .spec.template.metadata.annotations;
    expect(Date.parse(annotations["kubectl.kubernetes.io/restartedAt"] ?? "")).not.toBeNaN();
  });

  it("refuses to restart a kind that cannot be restarted", async () => {
    const result = await restartKubernetesResource.invoke(
      { kind: "Pod", name: "web-1", namespace: "default" },
      config("cluster-a"),
    );

    expect(result).toContain('Restart is not supported for kind "Pod"');
    expect(cluster.requests).toEqual([]);
  });
});
