// A stand-in for the host's `KubeJsonApi` of one cluster, for the tests of the
// Kubernetes tools. It answers a GET from a map of paths to objects (the
// discovery documents included) and records every request, so a test asserts
// what the tools would put on the wire.

import { Main } from "@freelensapp/extensions";
import { vi } from "vitest";

export interface RecordedKubeRequest {
  method: "get" | "post" | "put" | "patch" | "del" | "getResponse";
  path: string;
  query?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
}

interface Params {
  query?: Record<string, unknown>;
  data?: unknown;
}

interface Init {
  headers?: Record<string, string>;
}

// The discovery documents of the group versions the tests use.
export const DISCOVERY = {
  "/api/v1": {
    resources: [
      { name: "pods", kind: "Pod", namespaced: true },
      { name: "pods/log", kind: "Pod", namespaced: true },
      { name: "pods/eviction", kind: "Eviction", namespaced: true },
      { name: "namespaces", kind: "Namespace", namespaced: false },
      { name: "events", kind: "Event", namespaced: true },
    ],
  },
  "/apis/apps/v1": {
    resources: [
      { name: "deployments/scale", kind: "Scale", namespaced: true },
      { name: "deployments", kind: "Deployment", namespaced: true },
      { name: "daemonsets", kind: "DaemonSet", namespaced: true },
      { name: "statefulsets", kind: "StatefulSet", namespaced: true },
    ],
  },
  "/apis/kustomize.toolkit.fluxcd.io/v1": {
    resources: [{ name: "kustomizations", kind: "Kustomization", namespaced: true }],
  },
};

export const createFakeKubeJsonApi = (
  objects: Record<string, unknown> = {},
  { logs = {} }: { logs?: Record<string, { status: number; text: string }> } = {},
) => {
  const requests: RecordedKubeRequest[] = [];
  const known: Record<string, unknown> = { ...DISCOVERY, ...objects };

  const record = (method: RecordedKubeRequest["method"], path: string, params?: Params, init?: Init) => {
    requests.push({ method, path, query: params?.query, data: params?.data, headers: init?.headers });
  };

  const api = {
    get: vi.fn(async (path: string, params?: Params, init?: Init) => {
      record("get", path, params, init);
      if (!(path in known)) {
        // The shape of a JsonApi error: the API server's Status.
        throw { code: 404, reason: "NotFound", message: `${path} not found` };
      }
      return structuredClone(known[path]);
    }),
    post: vi.fn(async (path: string, params?: Params, init?: Init) => {
      record("post", path, params, init);
      return params?.data ?? {};
    }),
    put: vi.fn(async (path: string, params?: Params, init?: Init) => {
      record("put", path, params, init);
      return params?.data ?? {};
    }),
    patch: vi.fn(async (path: string, params?: Params, init?: Init) => {
      record("patch", path, params, init);
      return params?.data ?? {};
    }),
    del: vi.fn(async (path: string, params?: Params, init?: Init) => {
      record("del", path, params, init);
      return {};
    }),
    getResponse: vi.fn(async (path: string, params?: Params, init?: Init) => {
      record("getResponse", path, params, init);
      const answer = logs[path] ?? { status: 404, text: JSON.stringify({ code: 404, message: `${path} not found` }) };
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        text: async () => answer.text,
      };
    }),
  };

  // The requests other than the discovery reads, which every tool makes first.
  const actions = () => requests.filter((entry) => !(entry.method === "get" && entry.path in DISCOVERY));

  return { api, requests, actions };
};

/**
 * Registers clusters with the stubbed `Main.Catalog` and `KubeJsonApi.forCluster`,
 * each with its own fake API, and returns the fakes by cluster id.
 */
export const installFakeClusters = (clusters: Record<string, ReturnType<typeof createFakeKubeJsonApi>>) => {
  vi.mocked(Main.Catalog.getClusterById).mockImplementation(
    (id: string) => (id in clusters ? { id } : undefined) as ReturnType<typeof Main.Catalog.getClusterById>,
  );
  vi.mocked(Main.K8sApi.KubeJsonApi.forCluster).mockImplementation((id: string) => {
    const cluster = clusters[id];
    if (!cluster) {
      throw new Error(`No fake API for cluster ${id}`);
    }
    return cluster.api as unknown as ReturnType<typeof Main.K8sApi.KubeJsonApi.forCluster>;
  });
};
