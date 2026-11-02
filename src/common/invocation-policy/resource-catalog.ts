/**
 * One resource of a cluster's discovery, as `kubectl api-resources -o wide`
 * lists it.
 */
export interface CatalogResource {
  /** The plural name, the name a canonical form uses: `deployments`. */
  name: string;
  shortNames: readonly string[];
  /** The API group, `""` for the core group. */
  group: string;
  kind: string;
  namespaced: boolean;
  /** Categories such as `all`, which `kubectl get all` expands. */
  categories: readonly string[];
}

/** The resources of a cluster, in discovery order: an ambiguous name resolves to the first. */
export type ResourceCatalog = readonly CatalogResource[];

const resource = (
  name: string,
  group: string,
  kind: string,
  namespaced: boolean,
  shortNames: readonly string[] = [],
  categories: readonly string[] = [],
): CatalogResource => ({ name, shortNames, group, kind, namespaced, categories });

/**
 * The built-in kinds of Kubernetes 1.36 that its API server serves by default,
 * for callers without a cluster (the test box of the preferences). The
 * cluster's own catalog comes from its discovery.
 */
export const BUILT_IN_RESOURCE_CATALOG: ResourceCatalog = [
  resource("bindings", "", "Binding", true),
  resource("componentstatuses", "", "ComponentStatus", false, ["cs"]),
  resource("configmaps", "", "ConfigMap", true, ["cm"]),
  resource("endpoints", "", "Endpoints", true, ["ep"]),
  resource("events", "", "Event", true, ["ev"]),
  resource("limitranges", "", "LimitRange", true, ["limits"]),
  resource("namespaces", "", "Namespace", false, ["ns"]),
  resource("nodes", "", "Node", false, ["no"]),
  resource("persistentvolumeclaims", "", "PersistentVolumeClaim", true, ["pvc"]),
  resource("persistentvolumes", "", "PersistentVolume", false, ["pv"]),
  resource("pods", "", "Pod", true, ["po"], ["all"]),
  resource("podtemplates", "", "PodTemplate", true),
  resource("replicationcontrollers", "", "ReplicationController", true, ["rc"], ["all"]),
  resource("resourcequotas", "", "ResourceQuota", true, ["quota"]),
  resource("secrets", "", "Secret", true),
  resource("serviceaccounts", "", "ServiceAccount", true, ["sa"]),
  resource("services", "", "Service", true, ["svc"], ["all"]),
  resource("mutatingwebhookconfigurations", "admissionregistration.k8s.io", "MutatingWebhookConfiguration", false),
  resource("validatingadmissionpolicies", "admissionregistration.k8s.io", "ValidatingAdmissionPolicy", false),
  resource(
    "validatingadmissionpolicybindings",
    "admissionregistration.k8s.io",
    "ValidatingAdmissionPolicyBinding",
    false,
  ),
  resource("validatingwebhookconfigurations", "admissionregistration.k8s.io", "ValidatingWebhookConfiguration", false),
  resource("customresourcedefinitions", "apiextensions.k8s.io", "CustomResourceDefinition", false, ["crd", "crds"]),
  resource("apiservices", "apiregistration.k8s.io", "APIService", false),
  resource("controllerrevisions", "apps", "ControllerRevision", true),
  resource("daemonsets", "apps", "DaemonSet", true, ["ds"], ["all"]),
  resource("deployments", "apps", "Deployment", true, ["deploy"], ["all"]),
  resource("replicasets", "apps", "ReplicaSet", true, ["rs"], ["all"]),
  resource("statefulsets", "apps", "StatefulSet", true, ["sts"], ["all"]),
  resource("selfsubjectreviews", "authentication.k8s.io", "SelfSubjectReview", false),
  resource("tokenreviews", "authentication.k8s.io", "TokenReview", false),
  resource("localsubjectaccessreviews", "authorization.k8s.io", "LocalSubjectAccessReview", true),
  resource("selfsubjectaccessreviews", "authorization.k8s.io", "SelfSubjectAccessReview", false),
  resource("selfsubjectrulesreviews", "authorization.k8s.io", "SelfSubjectRulesReview", false),
  resource("subjectaccessreviews", "authorization.k8s.io", "SubjectAccessReview", false),
  resource("horizontalpodautoscalers", "autoscaling", "HorizontalPodAutoscaler", true, ["hpa"], ["all"]),
  resource("cronjobs", "batch", "CronJob", true, ["cj"], ["all"]),
  resource("jobs", "batch", "Job", true, [], ["all"]),
  resource("certificatesigningrequests", "certificates.k8s.io", "CertificateSigningRequest", false, ["csr"]),
  resource("leases", "coordination.k8s.io", "Lease", true),
  resource("endpointslices", "discovery.k8s.io", "EndpointSlice", true),
  resource("events", "events.k8s.io", "Event", true, ["ev"]),
  resource("flowschemas", "flowcontrol.apiserver.k8s.io", "FlowSchema", false),
  resource("prioritylevelconfigurations", "flowcontrol.apiserver.k8s.io", "PriorityLevelConfiguration", false),
  resource("ingressclasses", "networking.k8s.io", "IngressClass", false),
  resource("ingresses", "networking.k8s.io", "Ingress", true, ["ing"]),
  resource("ipaddresses", "networking.k8s.io", "IPAddress", false, ["ip"]),
  resource("networkpolicies", "networking.k8s.io", "NetworkPolicy", true, ["netpol"]),
  resource("servicecidrs", "networking.k8s.io", "ServiceCIDR", false),
  resource("runtimeclasses", "node.k8s.io", "RuntimeClass", false),
  resource("poddisruptionbudgets", "policy", "PodDisruptionBudget", true, ["pdb"]),
  resource("deviceclasses", "resource.k8s.io", "DeviceClass", false),
  resource("resourceclaims", "resource.k8s.io", "ResourceClaim", true),
  resource("resourceclaimtemplates", "resource.k8s.io", "ResourceClaimTemplate", true),
  resource("resourceslices", "resource.k8s.io", "ResourceSlice", false),
  resource("clusterrolebindings", "rbac.authorization.k8s.io", "ClusterRoleBinding", false),
  resource("clusterroles", "rbac.authorization.k8s.io", "ClusterRole", false),
  resource("rolebindings", "rbac.authorization.k8s.io", "RoleBinding", true),
  resource("roles", "rbac.authorization.k8s.io", "Role", true),
  resource("priorityclasses", "scheduling.k8s.io", "PriorityClass", false, ["pc"]),
  resource("csidrivers", "storage.k8s.io", "CSIDriver", false),
  resource("csinodes", "storage.k8s.io", "CSINode", false),
  resource("csistoragecapacities", "storage.k8s.io", "CSIStorageCapacity", true),
  resource("storageclasses", "storage.k8s.io", "StorageClass", false, ["sc"]),
  resource("volumeattachments", "storage.k8s.io", "VolumeAttachment", false),
  resource("volumeattributesclasses", "storage.k8s.io", "VolumeAttributesClass", false, ["vac"]),
];

const VERSION = /^v\d+((alpha|beta)\d+)?$/;

const matchesName = (entry: CatalogResource, name: string): boolean =>
  entry.name === name || entry.kind.toLowerCase() === name || entry.shortNames.includes(name);

/**
 * The resource a name of kubectl's command line names: a plural, a singular, a
 * short name or a kind, alone or qualified with a group (`deployments.apps`) or
 * a version and a group (`deployments.v1.apps`). Names are matched without
 * case, as kubectl matches them.
 */
export function findCatalogResource(catalog: ResourceCatalog, spelling: string): CatalogResource | undefined {
  const lowered = spelling.toLowerCase();
  const plain = catalog.find((entry) => matchesName(entry, lowered));
  if (plain) return plain;

  const [name = "", ...qualifier] = lowered.split(".");
  if (qualifier.length === 0) return undefined;
  const group = qualifier.join(".");
  const versioned = VERSION.test(qualifier[0] ?? "") ? qualifier.slice(1).join(".") : undefined;
  return catalog.find(
    (entry) =>
      matchesName(entry, name) && (entry.group === group || (versioned !== undefined && entry.group === versioned)),
  );
}

/** The resources of a category such as `all`. */
export const findCategoryResources = (catalog: ResourceCatalog, category: string): CatalogResource[] =>
  catalog.filter((entry) => entry.categories.includes(category.toLowerCase()));

/** The resource of a manifest object, by its kind and the group of its apiVersion. */
export const findCatalogKind = (
  catalog: ResourceCatalog,
  apiVersion: string,
  kind: string,
): CatalogResource | undefined => {
  const group = apiVersion.includes("/") ? apiVersion.slice(0, apiVersion.lastIndexOf("/")) : "";
  return catalog.find((entry) => entry.kind === kind && entry.group === group);
};
