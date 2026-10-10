import { Renderer } from "@freelensapp/extensions";
import { PreferencesStore } from "../../../common/store";

import type { KubernetesVersionInfo } from "../../../common/agent-tools/version-summary";
import type { Cluster, ClusterResource, ResourceApi } from "./cluster-tools";

type KubeObject = Renderer.K8sApi.KubeObject;
// The exact store type the host ApiManager returns.
type KubeObjectStore = NonNullable<ReturnType<typeof Renderer.K8sApi.apiManager.getStore>>;
// The host store types its write params as a deep-partial of the KubeObject,
// which a free-form manifest cannot satisfy; cast through `unknown` instead.
type CreateData = Parameters<KubeObjectStore["create"]>[1];
type UpdateData = Parameters<KubeObjectStore["update"]>[1];
type DeleteOptions = Parameters<KubeObjectStore["removeWithOptions"]>[1];

// The host KubeApi has no public way to patch a subresource, and its request
// client is protected. Describe the surface we rely on.
interface SubresourcePatchApi {
  formatUrlForNotListing(desc: { name?: string; namespace?: string }): string;
  request: {
    patch(path: string, params: { data: unknown }, reqInit: { headers: Record<string, string> }): Promise<unknown>;
  };
}

// Subresource patches such as an in-place Pod resize merge array entries by
// their `name` key, which needs a strategic merge patch.
const STRATEGIC_MERGE_PATCH_CONTENT_TYPE = "application/strategic-merge-patch+json";

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
 * `Cluster` on the Freelens renderer API of this cluster frame. Kinds are
 * looked up in the cluster's API discovery (`apiManager`), so CRDs and
 * irregular plurals resolve to the paths the cluster really serves.
 */
export const freelensCluster: Cluster = {
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
    const load = async (name: string, namespace: string | undefined) => {
      const object = await store.load({ name, namespace });
      if (!object) throw new Error(`The ${kind} "${name}" does not exist`);
      return object;
    };
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
      async create(name, namespace, manifest) {
        await store.create({ name, namespace }, manifest as unknown as CreateData);
      },
      async update(name, namespace, manifest) {
        await store.update(await load(name, namespace), manifest as unknown as UpdateData);
      },
      async patch(name, namespace, data, subresource) {
        if (!subresource) {
          await store.patch(await load(name, namespace), data as unknown as UpdateData, "merge");
          return;
        }
        // The store cannot target a subresource: build the resource URL and
        // PATCH `<url>/<subresource>` through the KubeApi request client.
        const patchApi = api as unknown as SubresourcePatchApi;
        const url = `${patchApi.formatUrlForNotListing({ name, namespace })}/${subresource}`;
        await patchApi.request.patch(
          url,
          { data },
          { headers: { "content-type": STRATEGIC_MERGE_PATCH_CONTENT_TYPE } },
        );
      },
      async remove(name, namespace, mode) {
        const object = await load(name, namespace);
        if (mode === "force_delete") {
          await store.removeWithOptions(object, {
            gracePeriodSeconds: 0,
            propagationPolicy: "Background",
          } as unknown as DeleteOptions);
        } else if (mode === "force_finalize") {
          await store.patch(object, { metadata: { finalizers: [] } } as unknown as UpdateData, "merge");
        } else {
          await store.remove(object);
        }
      },
    };
  },

  async deletePod(name, namespace, mode) {
    const podsApi = Renderer.K8sApi.podsApi;
    if (mode === "evict") await podsApi.evict({ name, namespace });
    else if (mode === "force_delete") await podsApi.forceDelete({ name, namespace });
    else await podsApi.deleteWithFinalizers({ name, namespace });
  },

  async restartWorkload(kind, name, namespace) {
    const api = {
      Deployment: Renderer.K8sApi.deploymentApi,
      DaemonSet: Renderer.K8sApi.daemonSetApi,
      StatefulSet: Renderer.K8sApi.statefulSetApi,
    }[kind];
    await api.restart({ name, namespace });
  },

  async getPodLogs(name, namespace, { container, tailLines, timestamps, previous }) {
    return Renderer.K8sApi.podsApi.getLogs({ name, namespace }, { container, tailLines, timestamps, previous });
  },

  podLogsTailLines() {
    return PreferencesStore.getInstanceOrCreate<PreferencesStore>().podLogsTailLines;
  },
};
