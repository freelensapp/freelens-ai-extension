import { Renderer } from "@freelensapp/extensions";

import type { KubernetesVersionInfo } from "../../../common/agent-tools/version-summary";
import type { ClusterReader, ClusterResource, ResourceApi } from "./cluster-tools";

type KubeObject = Renderer.K8sApi.KubeObject;

// The host KubeApi exposes the shared cluster `KubeJsonApi` client through a
// protected `request` property with no public accessor. Describe the minimal
// surface we rely on (a typed GET) and reach it through a structural cast via
// `unknown` (the project forbids `as any`).
interface VersionRequestApi {
  request: {
    get<T>(path: string): Promise<T>;
  };
}

function toResource(object: KubeObject): ClusterResource {
  return {
    name: object.getName(),
    namespace: object.getNs(),
    metadata: object.metadata,
    spec: object.spec,
    status: object.status,
  };
}

/**
 * `ClusterReader` on the Freelens renderer API of this cluster frame. Kinds are
 * looked up in the cluster's API discovery (`apiManager`), so CRDs and
 * irregular plurals resolve to the paths the cluster really serves.
 */
export const freelensCluster: ClusterReader = {
  async getVersionInfo() {
    // Any registered KubeApi shares the cluster client, so the pods API reaches `/version`.
    const api = Renderer.K8sApi.podsApi as unknown as VersionRequestApi;
    return api.request.get<KubernetesVersionInfo>("/version");
  },

  getNamespaceNames() {
    const store = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.namespacesApi);
    return store ? store.items.map((namespace) => namespace.getName()) : [];
  },

  async getEvents(namespace) {
    const store = Renderer.K8sApi.apiManager.getStore(Renderer.K8sApi.eventApi);
    if (!store) {
      // An empty list would read as "no warnings".
      throw new Error("The event store is not available in this cluster window.");
    }
    // The store holds only what the UI has loaded so far; fetch the namespace first.
    const loaded = await store.loadAll({ namespaces: [namespace] });
    return loaded ?? store.getAllByNs(namespace);
  },

  getResourceApi(kind, apiVersion): ResourceApi | string {
    const api = Renderer.K8sApi.apiManager.getApiByKind(kind, apiVersion);
    if (!api) {
      return `Could not resolve a Kubernetes API for kind "${kind}" and apiVersion "${apiVersion}".`;
    }
    const store = Renderer.K8sApi.apiManager.getStore(api);
    if (!store) {
      return `Could not resolve a store for kind "${kind}".`;
    }
    return {
      namespaced: api.isNamespaced,
      async list(namespace) {
        const loaded = await store.loadAll(namespace ? { namespaces: [namespace] } : {});
        const items = loaded ?? (namespace ? store.getAllByNs(namespace) : store.items.toJSON());
        return items.map(toResource);
      },
      async get(name, namespace) {
        const object = await store.load({ name, namespace });
        return object ? toResource(object) : undefined;
      },
    };
  },
};
