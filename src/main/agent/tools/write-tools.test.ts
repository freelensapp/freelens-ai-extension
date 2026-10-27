import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeKubeJsonApi, ParsedApiErrorStandIn } from "../../../../test/kube-json-api";
import { AGENT_TOOLS } from "../../../common/agent-tools";
import { WRITE_TOOL_RUNNERS } from "./write-tools";

const WEB = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "shop" },
  spec: { replicas: 2 },
};

let cluster: ReturnType<typeof createFakeKubeJsonApi>;
let controller: AbortController;

beforeEach(() => {
  cluster = createFakeKubeJsonApi({ "/apis/apps/v1/namespaces/shop/deployments/web": WEB });
  controller = new AbortController();
});

const run = (toolName: string, args: Record<string, unknown>) => {
  const runner = WRITE_TOOL_RUNNERS[toolName];
  if (!runner) throw new Error(`No runner for ${toolName}`);
  return runner(args, { api: cluster.api, signal: controller.signal, podLogsTailLines: 500 });
};

// A request as the stand-in records it, every field spelled out for toStrictEqual.
const sent = (
  method: string,
  path: string,
  { query, data, contentType }: { query?: Record<string, unknown>; data?: unknown; contentType?: string } = {},
) => ({
  method,
  path,
  query,
  data,
  headers: contentType ? { "content-type": contentType } : undefined,
  signal: controller.signal,
});

const MERGE_PATCH = "application/merge-patch+json";
const STRATEGIC_MERGE_PATCH = "application/strategic-merge-patch+json";

describe("write tools", () => {
  describe("createKubernetesResource", () => {
    it("posts the manifest with its kind, apiVersion, name and namespace set", async () => {
      const result = await run("createKubernetesResource", {
        kind: "Deployment",
        name: "api",
        namespace: "shop",
        data: { apiVersion: "apps/v9", kind: "Deploy", metadata: { labels: { app: "api" } }, spec: { replicas: 1 } },
      });

      expect(result).toBe('Deployment "api" created successfully');
      expect(cluster.actions()).toStrictEqual([
        sent("post", "/apis/apps/v1/namespaces/shop/deployments", {
          data: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            metadata: { labels: { app: "api" }, name: "api", namespace: "shop" },
            spec: { replicas: 1 },
          },
        }),
      ]);
    });
    it("leaves the namespace off a cluster-scoped kind", async () => {
      await run("createKubernetesResource", { kind: "Namespace", apiVersion: "v1", name: "team", data: {} });

      expect(cluster.actions()).toStrictEqual([
        sent("post", "/api/v1/namespaces", {
          data: { apiVersion: "v1", kind: "Namespace", metadata: { name: "team" } },
        }),
      ]);
    });

    it("asks for a namespace for a namespaced kind and sends nothing", async () => {
      expect(await run("createKubernetesResource", { kind: "Deployment", name: "api", data: {} })).toBe(
        'Kind "Deployment" is namespaced; please provide a namespace to create "api".',
      );
      expect(cluster.actions()).toStrictEqual([]);
    });
  });

  describe("updateKubernetesResource", () => {
    it("puts the manifest with its kind, apiVersion, name and namespace set", async () => {
      const result = await run("updateKubernetesResource", {
        kind: "Deployment",
        name: "web",
        namespace: "shop",
        data: { metadata: { name: "other", labels: { app: "web" } }, spec: { replicas: 4 } },
      });

      expect(result).toBe('Deployment "web" updated successfully');
      expect(cluster.actions()).toStrictEqual([
        sent("put", "/apis/apps/v1/namespaces/shop/deployments/web", {
          data: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            metadata: { name: "web", labels: { app: "web" }, namespace: "shop" },
            spec: { replicas: 4 },
          },
        }),
      ]);
    });

    it("asks for a namespace for a namespaced kind and sends nothing", async () => {
      expect(await run("updateKubernetesResource", { kind: "Deployment", name: "web", data: {} })).toBe(
        'Kind "Deployment" is namespaced; please provide a namespace to update "web".',
      );
      expect(cluster.actions()).toStrictEqual([]);
    });
  });

  describe("patchKubernetesResource", () => {
    it("sends a JSON merge patch", async () => {
      const result = await run("patchKubernetesResource", {
        kind: "Deployment",
        name: "web",
        namespace: "shop",
        data: { metadata: { labels: { tier: "front" } } },
      });

      expect(result).toBe('Deployment "web" patched successfully');
      expect(cluster.actions()).toStrictEqual([
        sent("patch", "/apis/apps/v1/namespaces/shop/deployments/web", {
          data: { metadata: { labels: { tier: "front" } } },
          contentType: MERGE_PATCH,
        }),
      ]);
    });

    it("sends a strategic merge patch to a subresource", async () => {
      const result = await run("patchKubernetesResource", {
        kind: "Deployment",
        name: "web",
        namespace: "shop",
        data: { spec: { replicas: 3 } },
        subresource: "scale",
      });

      expect(result).toBe('Deployment "web" scale subresource patched successfully');
      expect(cluster.actions()).toStrictEqual([
        sent("patch", "/apis/apps/v1/namespaces/shop/deployments/web/scale", {
          data: { spec: { replicas: 3 } },
          contentType: STRATEGIC_MERGE_PATCH,
        }),
      ]);
    });

    it("asks for a namespace for a namespaced kind and sends nothing", async () => {
      expect(await run("patchKubernetesResource", { kind: "Deployment", name: "web", data: {} })).toBe(
        'Kind "Deployment" is namespaced; please provide a namespace to patch "web".',
      );
      expect(cluster.actions()).toStrictEqual([]);
    });
  });
  describe("deleteKubernetesResource", () => {
    const deleteWeb = (mode?: string) =>
      run("deleteKubernetesResource", {
        kind: "Deployment",
        name: "web",
        namespace: "shop",
        ...(mode ? { mode } : {}),
      });

    it("deletes with background propagation", async () => {
      expect(await deleteWeb()).toBe('Deployment "web" deleted successfully');
      expect(cluster.actions()).toStrictEqual([
        sent("del", "/apis/apps/v1/namespaces/shop/deployments/web", { query: { propagationPolicy: "Background" } }),
      ]);
    });

    it("force deletes with a grace period of 0", async () => {
      expect(await deleteWeb("force_delete")).toBe('Deployment "web" force-deleted successfully');
      expect(cluster.actions()).toStrictEqual([
        sent("del", "/apis/apps/v1/namespaces/shop/deployments/web", {
          query: { propagationPolicy: "Background" },
          data: { kind: "DeleteOptions", apiVersion: "v1", gracePeriodSeconds: 0, propagationPolicy: "Background" },
        }),
      ]);
    });

    it("force finalizes by clearing the finalizers with a merge patch", async () => {
      expect(await deleteWeb("force_finalize")).toBe('Deployment "web" finalizers cleared successfully');
      expect(cluster.actions()).toStrictEqual([
        sent("patch", "/apis/apps/v1/namespaces/shop/deployments/web", {
          data: { metadata: { finalizers: [] } },
          contentType: MERGE_PATCH,
        }),
      ]);
    });

    it("asks for a namespace for a namespaced kind and sends nothing", async () => {
      expect(await run("deleteKubernetesResource", { kind: "Deployment", name: "web" })).toBe(
        'Kind "Deployment" is namespaced; please provide a namespace to delete "web".',
      );
      expect(cluster.actions()).toStrictEqual([]);
    });
  });
  describe("deletePod", () => {
    const POD_PATH = "/api/v1/namespaces/shop/pods/web-1";
    const FORCE_DELETE = {
      query: { propagationPolicy: "Background" },
      data: { kind: "DeleteOptions", apiVersion: "v1", gracePeriodSeconds: 0, propagationPolicy: "Background" },
    };
    const deleteWeb1 = (mode: string) => run("deletePod", { name: "web-1", namespace: "shop", mode });
    const apiError = (code: number, message: string) => new ParsedApiErrorStandIn({ code, message }, [message]);

    it("evicts through the eviction subresource", async () => {
      expect(await deleteWeb1("evict")).toBe('Pod "web-1" evicted successfully');
      expect(cluster.actions()).toStrictEqual([
        sent("post", `${POD_PATH}/eviction`, {
          data: { apiVersion: "policy/v1", kind: "Eviction", metadata: { name: "web-1", namespace: "shop" } },
        }),
      ]);
    });

    it("force deletes with a grace period of 0", async () => {
      expect(await deleteWeb1("force_delete")).toBe('Pod "web-1" force-deleted successfully');
      expect(cluster.actions()).toStrictEqual([sent("del", POD_PATH, FORCE_DELETE)]);
    });

    it("clears the finalizers with a JSON merge patch setting them to null, then force deletes the pod", async () => {
      expect(await deleteWeb1("delete_with_finalizers")).toBe(
        'Pod "web-1" deleted and finalizers cleared successfully',
      );
      expect(cluster.actions()).toStrictEqual([
        sent("patch", POD_PATH, { data: { metadata: { finalizers: null } }, contentType: MERGE_PATCH }),
        sent("del", POD_PATH, FORCE_DELETE),
      ]);
    });

    it("reports the finalizers the cluster still lists after the delete", async () => {
      const kept = { metadata: { name: "web-1", namespace: "shop", finalizers: ["example.com/protect"] } };
      cluster = createFakeKubeJsonApi({}, { answers: { [`patch ${POD_PATH}`]: kept, [`del ${POD_PATH}`]: kept } });

      expect(await deleteWeb1("delete_with_finalizers")).toBe(
        'The cluster kept the finalizers of Pod "web-1": example.com/protect. Pod "web-1" is marked for deletion ' +
          "but still has the finalizers example.com/protect, so it stays until they are removed.",
      );
    });

    it("still force deletes the pod when clearing the finalizers fails, and says so", async () => {
      cluster = createFakeKubeJsonApi(
        {},
        { answers: { [`patch ${POD_PATH}`]: apiError(403, 'pods "web-1" is forbidden: cannot patch') } },
      );

      expect(await deleteWeb1("delete_with_finalizers")).toBe(
        'Clearing the finalizers of Pod "web-1" failed: pods "web-1" is forbidden: cannot patch. ' +
          'Pod "web-1" was force-deleted.',
      );
      expect(cluster.actions().map(({ method }) => method)).toEqual(["patch", "del"]);
    });

    it("reports cleared finalizers when the delete that follows fails", async () => {
      cluster = createFakeKubeJsonApi(
        {},
        { answers: { [`del ${POD_PATH}`]: apiError(404, 'pods "web-1" not found') } },
      );

      await expect(deleteWeb1("delete_with_finalizers")).rejects.toThrow(
        'The finalizers of Pod "web-1" were cleared. Deleting it failed: pods "web-1" not found',
      );
    });

    it("sends no delete once the call is stopped while clearing the finalizers", async () => {
      cluster = createFakeKubeJsonApi({}, { hang: [POD_PATH] });

      const deleting = deleteWeb1("delete_with_finalizers");
      controller.abort();

      await expect(deleting).rejects.toThrow("This operation was aborted");
      expect(cluster.actions().map(({ method }) => method)).toEqual(["patch"]);
    });
  });
  describe("restartKubernetesResource", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      ["Deployment", "/apis/apps/v1/namespaces/shop/deployments/web"],
      ["DaemonSet", "/apis/apps/v1/namespaces/shop/daemonsets/web"],
      ["StatefulSet", "/apis/apps/v1/namespaces/shop/statefulsets/web"],
    ])("restarts a %s with a strategic merge patch of the restartedAt annotation", async (kind, path) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-27T10:00:00.000Z"));

      expect(await run("restartKubernetesResource", { kind, name: "web", namespace: "shop" })).toBe(
        `${kind} "web" restarted successfully`,
      );
      expect(cluster.actions()).toStrictEqual([
        sent("patch", path, {
          data: {
            spec: {
              template: {
                metadata: { annotations: { "kubectl.kubernetes.io/restartedAt": "2026-10-27T10:00:00.000Z" } },
              },
            },
          },
          contentType: STRATEGIC_MERGE_PATCH,
        }),
      ]);
    });
  });

  it("answers a kind the cluster does not serve with a message for the model and sends nothing", async () => {
    expect(
      await run("deleteKubernetesResource", {
        kind: "Widget",
        apiVersion: "example.com/v1",
        name: "w",
        namespace: "shop",
      }),
    ).toBe('Could not resolve a Kubernetes API for kind "Widget" and apiVersion "example.com/v1".');
    expect(cluster.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "getResponse /apis/example.com/v1",
    ]);
  });

  it("rejects with the cluster's error when a write fails", async () => {
    const forbidden = new ParsedApiErrorStandIn({ code: 403, message: "forbidden" }, ["forbidden"]);
    cluster = createFakeKubeJsonApi({}, { answers: { "post /api/v1/namespaces/shop/pods/web-1/eviction": forbidden } });

    await expect(run("deletePod", { name: "web-1", namespace: "shop", mode: "evict" })).rejects.toBe(forbidden);
  });

  it("has a runner for every write tool", () => {
    expect(Object.keys(WRITE_TOOL_RUNNERS).sort()).toEqual(
      AGENT_TOOLS.filter((tool) => tool.mutating)
        .map((tool) => tool.name)
        .sort(),
    );
  });
});
