import { beforeEach, describe, expect, it } from "vitest";
import { createFakeKubeJsonApi, installFakeClusters } from "../../../../test/kube-json-api";
import { clusterApiFor, type KubeJsonApi } from "./cluster-api";

const config = (clusterId?: string) => ({ configurable: { clusterId } });

let cluster: ReturnType<typeof createFakeKubeJsonApi>;

beforeEach(() => {
  cluster = createFakeKubeJsonApi({ "/api/v1/namespaces": { items: [] } });
  installFakeClusters({ "cluster-a": cluster });
});

const clusterApi = (): KubeJsonApi => {
  const api = clusterApiFor(config("cluster-a"));
  if (typeof api === "string") {
    throw new Error(api);
  }
  return api;
};

describe("the client of a run's cluster", () => {
  it.each([
    ["get", (api: KubeJsonApi, query: object) => api.get("/api/v1/namespaces", { query })],
    ["post", (api: KubeJsonApi, query: object) => api.post("/api/v1/namespaces", { query })],
    ["put", (api: KubeJsonApi, query: object) => api.put("/api/v1/namespaces", { query })],
    ["patch", (api: KubeJsonApi, query: object) => api.patch("/api/v1/namespaces", { query })],
    ["del", (api: KubeJsonApi, query: object) => api.del("/api/v1/namespaces", { query })],
    ["getResponse", (api: KubeJsonApi, query: object) => api.getResponse("/api/v1/namespaces", { query })],
  ])("leaves out the query values that are not set in %s", async (method, send) => {
    await send(clusterApi(), { dryRun: "All", previous: undefined, timestamps: null, follow: false, tailLines: 0 });

    expect(cluster.requests.at(-1)).toMatchObject({ method, path: "/api/v1/namespaces" });
    expect(cluster.requests.at(-1)?.query).toEqual({ dryRun: "All", follow: "false", tailLines: "0" });
  });

  it("passes the data and the headers of a request unchanged", async () => {
    await clusterApi().patch(
      "/api/v1/namespaces/default",
      { data: { metadata: { labels: { team: "web" } } } },
      { headers: { "content-type": "application/merge-patch+json" } },
    );

    expect(cluster.requests.at(-1)).toEqual({
      method: "patch",
      path: "/api/v1/namespaces/default",
      query: undefined,
      data: { metadata: { labels: { team: "web" } } },
      headers: { "content-type": "application/merge-patch+json" },
    });
  });
});
