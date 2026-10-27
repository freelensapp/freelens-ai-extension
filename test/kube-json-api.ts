// A stand-in for the host's `KubeJsonApi` of one cluster, for the tests of the
// cluster tools and the agent host. It answers a GET from a map of paths to
// objects (the discovery documents included) and records every request, so a
// test asserts what the tools would put on the wire.

import type { KubeJsonApi } from "../src/main/agent/tools/cluster-api";

interface RecordedKubeRequest {
  method: "get" | "post" | "put" | "patch" | "del" | "getResponse";
  path: string;
  query?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal | null;
}

interface Params {
  query?: Record<string, unknown>;
  data?: unknown;
}

interface Init {
  headers?: Record<string, string>;
  signal?: AbortSignal | null;
}

/**
 * The shape the host's client rejects with for a failed request other than a
 * GET answered 403: the API server's Status kept private, and its message as
 * the string form.
 */
export class ParsedApiErrorStandIn {
  isUsedForNotification = false;

  constructor(
    private readonly error: { code: number; reason?: string; message?: string },
    private readonly messages: string[],
  ) {}

  get isAborted() {
    return this.error.code === 20;
  }

  toString() {
    return this.messages.join("\n");
  }
}

// The discovery documents of the group versions the tests use.
const DISCOVERY = {
  "/api/v1": {
    resources: [
      { name: "pods", kind: "Pod", namespaced: true },
      { name: "pods/log", kind: "Pod", namespaced: true },
      { name: "pods/eviction", kind: "Eviction", namespaced: true },
      { name: "namespaces", kind: "Namespace", namespaced: false },
      { name: "nodes", kind: "Node", namespaced: false },
      { name: "events", kind: "Event", namespaced: true },
      { name: "services", kind: "Service", namespaced: true },
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
  "/apis/networking.k8s.io/v1": {
    resources: [
      { name: "ingresses", kind: "Ingress", namespaced: true },
      { name: "ingresses/status", kind: "Ingress", namespaced: true },
    ],
  },
  "/apis/kustomize.toolkit.fluxcd.io/v1": {
    resources: [{ name: "kustomizations", kind: "Kustomization", namespaced: true }],
  },
};

// Rejects as the host's fetch does when the request's signal aborts.
const abortError = () => new DOMException("This operation was aborted", "AbortError");

interface FakeKubeJsonApiOptions {
  logs?: Record<string, { status: number; text: string }>;
  hang?: readonly string[];
  answers?: Record<string, unknown>;
}

/**
 * `hang` lists paths whose requests never answer: they reject only when their
 * signal aborts, so a test can stop a run while a request is in progress.
 * `answers` sets what a write answers, by `"<method> <path>"` (for example
 * `"del /api/v1/namespaces/shop/pods/web-1"`); a `ParsedApiErrorStandIn` or an
 * `Error` there rejects. Without one, a delete answers `{}` and any other write
 * its own `data`.
 */
export const createFakeKubeJsonApi = (
  objects: Record<string, unknown> = {},
  { logs = {}, hang = [], answers = {} }: FakeKubeJsonApiOptions = {},
) => {
  const requests: RecordedKubeRequest[] = [];
  const known: Record<string, unknown> = { ...DISCOVERY, ...objects };

  const record = (method: RecordedKubeRequest["method"], path: string, params?: Params, init?: Init) => {
    requests.push({
      method,
      path,
      query: params?.query,
      data: params?.data,
      headers: init?.headers,
      signal: init?.signal,
    });
  };

  const hangUntilAborted = (signal: AbortSignal | null | undefined) =>
    new Promise<never>((_resolve, reject) => {
      if (signal?.aborted) reject(abortError());
      signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    });

  const answer = async (method: "post" | "put" | "patch" | "del", path: string, params?: Params, init?: Init) => {
    record(method, path, params, init);
    if (hang.includes(path)) return hangUntilAborted(init?.signal);
    const key = `${method} ${path}`;
    if (!(key in answers)) return method === "del" ? {} : (params?.data ?? {});
    const given = answers[key];
    if (given instanceof ParsedApiErrorStandIn || given instanceof Error) throw given;
    return structuredClone(given);
  };

  const fake = {
    get: async (path: string, params?: Params, init?: Init) => {
      record("get", path, params, init);
      if (hang.includes(path)) return hangUntilAborted(init?.signal);
      if (!(path in known)) {
        throw new ParsedApiErrorStandIn({ code: 404, reason: "NotFound", message: `${path} not found` }, [
          `${path} not found`,
        ]);
      }
      return structuredClone(known[path]);
    },
    post: (path: string, params?: Params, init?: Init) => answer("post", path, params, init),
    put: (path: string, params?: Params, init?: Init) => answer("put", path, params, init),
    patch: (path: string, params?: Params, init?: Init) => answer("patch", path, params, init),
    del: (path: string, params?: Params, init?: Init) => answer("del", path, params, init),
    getResponse: async (path: string, params?: Params, init?: Init) => {
      record("getResponse", path, params, init);
      if (hang.includes(path)) return hangUntilAborted(init?.signal);
      const answer = logs[path] ?? { status: 404, text: JSON.stringify({ code: 404, message: `${path} not found` }) };
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        text: async () => answer.text,
      };
    },
  };

  // The requests other than the discovery reads, which every tool makes first.
  const actions = () => requests.filter((entry) => !(entry.method === "get" && entry.path in DISCOVERY));

  // The host's client is generic in its answers; the stand-in answers plain objects.
  return { api: fake as unknown as KubeJsonApi, requests, actions };
};
