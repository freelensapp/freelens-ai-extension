// A stand-in for the host's `KubeJsonApi` of one cluster, for the tests of the
// Kubernetes tools. It answers a GET from a map of paths to objects (the
// discovery documents included), applies a JSON merge patch and a delete to
// those objects as the API server does, and records every request, so a test
// asserts what the tools would put on the wire and what it did.

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

// What the host's JsonApi throws for a path the API server does not have: a
// `JsonApiErrorParsed`, which keeps the API server's Status as `error`.
const notFound = (path: string) => {
  const message = `${path} not found`;
  return {
    isUsedForNotification: false,
    error: { kind: "Status", apiVersion: "v1", status: "Failure", reason: "NotFound", code: 404, message },
    messages: [message],
  };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A JSON merge patch (RFC 7386): objects merge, `null` removes a key, and any
// other value, a list included, replaces the target.
const applyMergePatch = (target: unknown, patch: unknown): unknown => {
  if (!isPlainObject(patch)) {
    return patch;
  }
  const result: Record<string, unknown> = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
    } else {
      result[key] = applyMergePatch(result[key], value);
    }
  }
  return result;
};

// The deletionTimestamp a delete sets on an object with finalizers.
export const DELETED_AT = "2026-10-16T07:54:46Z";

interface ObjectWithMetadata {
  metadata?: { deletionTimestamp?: string; finalizers?: string[] };
}

export const createFakeKubeJsonApi = (
  objects: Record<string, unknown> = {},
  { logs = {} }: { logs?: Record<string, { status: number; text: string }> } = {},
) => {
  const requests: RecordedKubeRequest[] = [];
  const known: Record<string, unknown> = structuredClone({ ...DISCOVERY, ...objects });

  const record = (method: RecordedKubeRequest["method"], path: string, params?: Params, init?: Init) => {
    requests.push({ method, path, query: params?.query, data: params?.data, headers: init?.headers });
  };

  // As the API server does: an object that is being deleted is removed once
  // it has no finalizers left.
  const removeWhenFinalized = (path: string) => {
    const metadata = (known[path] as ObjectWithMetadata | undefined)?.metadata;
    if (metadata?.deletionTimestamp && !metadata.finalizers?.length) {
      delete known[path];
    }
  };

  const api = {
    get: vi.fn(async (path: string, params?: Params, init?: Init) => {
      record("get", path, params, init);
      if (!(path in known)) {
        throw notFound(path);
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
    // A JSON merge patch of a known object changes it; any other patch, a
    // strategic merge patch included, is only recorded.
    patch: vi.fn(async (path: string, params?: Params, init?: Init) => {
      record("patch", path, params, init);
      if (path in known && init?.headers?.["content-type"] === "application/merge-patch+json") {
        known[path] = applyMergePatch(known[path], params?.data);
        const patched = structuredClone(known[path]);
        removeWhenFinalized(path);
        return patched;
      }
      return params?.data ?? {};
    }),
    // A delete removes a known object, or marks it as being deleted while it
    // has finalizers.
    del: vi.fn(async (path: string, params?: Params, init?: Init) => {
      record("del", path, params, init);
      const object = known[path] as ObjectWithMetadata | undefined;
      if (!object) {
        throw notFound(path);
      }
      object.metadata = { ...object.metadata, deletionTimestamp: object.metadata?.deletionTimestamp ?? DELETED_AT };
      removeWhenFinalized(path);
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

  return { api, requests, actions, objects: known };
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
