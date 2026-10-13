// Pure helpers that turn a kind and an apiVersion into the API paths of a
// resource, from the API server's discovery document of its group version.
// Kept free of host dependencies so they are unit-tested directly.

// The part of a discovery document (`GET /api/v1`, `GET /apis/<group>/<version>`)
// the tools read.
export interface ApiResourceList {
  resources?: { name: string; kind: string; namespaced: boolean }[];
}

export interface ResolvedResource {
  kind: string;
  // The group version, e.g. "v1" or "apps/v1".
  apiVersion: string;
  // The plural name in the URL, e.g. "deployments".
  plural: string;
  namespaced: boolean;
}

// The discovery path of a group version: the core group is under /api, every
// other group under /apis.
export const groupVersionPath = (apiVersion: string): string =>
  apiVersion.includes("/") ? `/apis/${apiVersion}` : `/api/${apiVersion}`;

/**
 * Finds the resource of `kind` in a discovery document, skipping subresources
 * such as "deployments/scale", which carry the kind of their parent too.
 */
export const findApiResource = (
  list: ApiResourceList,
  kind: string,
  apiVersion: string,
): ResolvedResource | undefined => {
  const resource = list.resources?.find((entry) => entry.kind === kind && !entry.name.includes("/"));
  return resource && { kind, apiVersion, plural: resource.name, namespaced: resource.namespaced };
};

/**
 * The path of a collection, or of one object when `name` is given. The
 * namespace is used only for a namespaced kind; without one, a namespaced
 * collection is listed across all namespaces.
 */
export const resourcePath = (
  resource: ResolvedResource,
  { name, namespace }: { name?: string; namespace?: string } = {},
): string => {
  const scope = resource.namespaced && namespace ? `/namespaces/${encodeURIComponent(namespace)}` : "";
  const object = name ? `/${encodeURIComponent(name)}` : "";
  return `${groupVersionPath(resource.apiVersion)}${scope}/${resource.plural}${object}`;
};
