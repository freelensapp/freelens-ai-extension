import { describe, expect, it } from "vitest";
import { findApiResource, groupVersionPath, type ResolvedResource, resourcePath } from "./resource-paths";

describe("groupVersionPath", () => {
  it("puts the core group under /api and every other group under /apis", () => {
    expect(groupVersionPath("v1")).toBe("/api/v1");
    expect(groupVersionPath("apps/v1")).toBe("/apis/apps/v1");
    expect(groupVersionPath("kustomize.toolkit.fluxcd.io/v1")).toBe("/apis/kustomize.toolkit.fluxcd.io/v1");
  });
});

describe("findApiResource", () => {
  const list = {
    resources: [
      { name: "deployments/scale", kind: "Scale", namespaced: true },
      { name: "deployments/status", kind: "Deployment", namespaced: true },
      { name: "deployments", kind: "Deployment", namespaced: true },
      { name: "clusterroles", kind: "ClusterRole", namespaced: false },
    ],
  };

  it("finds the resource of a kind and skips its subresources", () => {
    expect(findApiResource(list, "Deployment", "apps/v1")).toEqual({
      kind: "Deployment",
      apiVersion: "apps/v1",
      plural: "deployments",
      namespaced: true,
    });
  });

  it("keeps the scope of a cluster-scoped kind", () => {
    expect(findApiResource(list, "ClusterRole", "rbac.authorization.k8s.io/v1")?.namespaced).toBe(false);
  });

  it("finds nothing for a kind the group version does not serve", () => {
    expect(findApiResource(list, "Pod", "apps/v1")).toBeUndefined();
    expect(findApiResource({}, "Pod", "v1")).toBeUndefined();
  });
});

describe("resourcePath", () => {
  const deployment: ResolvedResource = {
    kind: "Deployment",
    apiVersion: "apps/v1",
    plural: "deployments",
    namespaced: true,
  };
  const namespace: ResolvedResource = { kind: "Namespace", apiVersion: "v1", plural: "namespaces", namespaced: false };

  it("builds the path of an object in a namespace", () => {
    expect(resourcePath(deployment, { name: "web", namespace: "default" })).toBe(
      "/apis/apps/v1/namespaces/default/deployments/web",
    );
  });

  it("lists a namespaced kind across all namespaces without a namespace", () => {
    expect(resourcePath(deployment)).toBe("/apis/apps/v1/deployments");
  });

  it("ignores the namespace of a cluster-scoped kind", () => {
    expect(resourcePath(namespace, { name: "flux-system", namespace: "default" })).toBe(
      "/api/v1/namespaces/flux-system",
    );
  });

  it("encodes the name and the namespace", () => {
    expect(resourcePath(deployment, { name: "a/b", namespace: "c d" })).toBe(
      "/apis/apps/v1/namespaces/c%20d/deployments/a%2Fb",
    );
  });
});
