import { type TSchema, Type } from "typebox";
import { Value } from "typebox/value";

/**
 * A Kubernetes manifest as a free-form object. The generic tools intentionally
 * skip validation for kinds we do not understand internally (CRDs and anything
 * else), so the manifest is passed through to the host as-is.
 */
export type Manifest = Record<string, unknown>;

/**
 * Extra, per-kind behavior layered on top of the generic resource operations.
 *
 * The set of kinds the model may target is intentionally open (the tools accept
 * any `kind` string), so this registry does NOT restrict which resources can be
 * handled. It only adds behavior for the kinds we understand internally:
 * a default apiVersion, stricter manifest validation, and special manifest
 * preparation. Unknown kinds (CRDs, etc.) simply have no entry and are treated
 * as free YAML/JSON passthrough.
 */
export interface ResourceHandler {
  /**
   * Default apiVersion (group/version) used to resolve the host KubeApi via
   * `apiManager.getApiByKind` when the model does not supply one. For CRDs the
   * model is expected to provide the apiVersion explicitly.
   */
  defaultApiVersion?: string;
  /**
   * Stricter manifest validation for kinds understood internally. Unknown kinds
   * skip validation entirely.
   */
  schema?: TSchema;
  /**
   * Special-case manifest preparation (for example forcing `apiVersion`/`kind`).
   * Defaults to identity for kinds without one. This is where resource-specific
   * business logic (a `buildPodManifest`-style helper) can live.
   */
  buildManifest?: (data: Manifest) => Manifest;
}

const stringMap = Type.Record(Type.String(), Type.String());

const containersSchema = Type.Array(
  Type.Object({
    name: Type.String(),
    image: Type.String(),
    ports: Type.Array(Type.Object({ containerPort: Type.Number() })),
  }),
);

const portNumber = Type.Integer({ minimum: 1, maximum: 65535 });

const oneOf = (values: string[]) => Type.Union(values.map((value) => Type.Literal(value)));

export const podManifestSchema = Type.Object(
  {
    apiVersion: Type.String(),
    kind: Type.String(),
    metadata: Type.Object({ name: Type.String(), namespace: Type.String() }),
    spec: Type.Object({ containers: containersSchema }),
  },
  { description: "Pod K8S manifest" },
);

export const deploymentManifestSchema = Type.Object(
  {
    apiVersion: Type.String(),
    kind: Type.String(),
    metadata: Type.Object({ name: Type.String(), namespace: Type.String() }),
    spec: Type.Object({
      replicas: Type.Number(),
      selector: Type.Object({ matchLabels: stringMap }),
      template: Type.Object({
        metadata: Type.Object({ labels: stringMap }),
        spec: Type.Object({ containers: containersSchema }),
      }),
    }),
  },
  { description: "Deployment K8S manifest" },
);

export const serviceManifestSchema = Type.Object(
  {
    apiVersion: Type.String(),
    kind: Type.String(),
    metadata: Type.Object({
      name: Type.String(),
      namespace: Type.Optional(Type.String()),
      labels: Type.Optional(stringMap),
      annotations: Type.Optional(stringMap),
    }),
    spec: Type.Object({
      type: Type.Optional(oneOf(["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"])),
      selector: Type.Optional(stringMap),
      ports: Type.Array(
        Type.Object({
          name: Type.Optional(Type.String()),
          protocol: Type.Optional(oneOf(["TCP", "UDP", "SCTP"])),
          port: portNumber,
          targetPort: Type.Union([portNumber, Type.String()]),
          nodePort: Type.Optional(Type.Integer({ minimum: 30000, maximum: 32767 })),
        }),
      ),
      clusterIP: Type.Optional(Type.String()),
      externalName: Type.Optional(Type.String()),
      sessionAffinity: Type.Optional(oneOf(["None", "ClientIP"])),
      ipFamilyPolicy: Type.Optional(oneOf(["SingleStack", "PreferDualStack", "RequireDualStack"])),
      ipFamilies: Type.Optional(Type.Array(Type.String())),
    }),
  },
  { description: "Service K8S manifest" },
);

/**
 * Service-specific manifest preparation: force the correct `apiVersion`/`kind`
 * so the host always receives a well-formed Service manifest.
 */
export function buildServiceManifest(data: Manifest): Manifest {
  return { ...data, apiVersion: "v1", kind: "Service" };
}

export const RESOURCE_HANDLERS: Record<string, ResourceHandler> = {
  Pod: { defaultApiVersion: "v1", schema: podManifestSchema },
  Deployment: { defaultApiVersion: "apps/v1", schema: deploymentManifestSchema },
  Service: { defaultApiVersion: "v1", schema: serviceManifestSchema, buildManifest: buildServiceManifest },
};

/**
 * Kinds with internal handlers. Listed in tool descriptions to hint the model,
 * but it is allowed to target any other kind (CRDs) as free YAML.
 */
export const SUPPORTED_KINDS = Object.keys(RESOURCE_HANDLERS);

/**
 * Workload kinds whose host KubeApi exposes a rollout `restart()` endpoint. The
 * restart tool only accepts these kinds; anything else is rejected up front.
 */
export const RESTARTABLE_KINDS = ["Deployment", "DaemonSet", "StatefulSet"] as const;

export type RestartableKind = (typeof RESTARTABLE_KINDS)[number];

/**
 * Whether a kind supports a rollout restart via its host KubeApi.
 */
export function isRestartableKind(kind: string): kind is RestartableKind {
  return (RESTARTABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * Deletion modes accepted by the generic delete tool. They mirror the Freelens
 * host `KubeObjectDeleteService` (`delete`, `force_delete`, `force_finalize`):
 *
 * - `delete`: the standard delete, honoring the resource's default grace period
 *   and finalizers (`store.remove`).
 * - `force_delete`: delete immediately with a zero grace period and background
 *   propagation, skipping graceful termination
 *   (`store.removeWithOptions({ gracePeriodSeconds: 0, propagationPolicy: "Background" })`).
 * - `force_finalize`: clear the object's finalizers via a merge patch so a
 *   resource stuck in `Terminating` can be removed (`store.patch`).
 */
export const DELETE_MODES = ["delete", "force_delete", "force_finalize"] as const;

export type DeleteMode = (typeof DELETE_MODES)[number];

/**
 * The default deletion mode when the model does not specify one.
 */
export const DEFAULT_DELETE_MODE: DeleteMode = "delete";

/**
 * Whether a string is one of the supported generic deletion modes.
 */
export function isDeleteMode(mode: string): mode is DeleteMode {
  return (DELETE_MODES as readonly string[]).includes(mode);
}

/**
 * Pod-specific deletion modes exposed by the dedicated pod delete tool. They map
 * to the extra methods on the host `PodApi`:
 *
 * - `evict`: request a graceful eviction through the Eviction subresource,
 *   honoring any matching PodDisruptionBudget (`podsApi.evict`).
 * - `force_delete`: delete the pod immediately with a zero grace period, useful
 *   for pods stuck on an unreachable node (`podsApi.forceDelete`).
 * - `delete_with_finalizers`: delete the pod and clear its finalizers so a pod
 *   stuck in `Terminating` is removed (`podsApi.deleteWithFinalizers`).
 */
export const POD_DELETE_MODES = ["evict", "force_delete", "delete_with_finalizers"] as const;

export type PodDeleteMode = (typeof POD_DELETE_MODES)[number];

/**
 * Whether a string is one of the supported pod deletion modes.
 */
export function isPodDeleteMode(mode: string): mode is PodDeleteMode {
  return (POD_DELETE_MODES as readonly string[]).includes(mode);
}

/**
 * Normalize a subresource name supplied by the model. Trims surrounding
 * whitespace and any leading/trailing slashes (so both "resize" and "/resize"
 * work), returning `undefined` when nothing is left so callers can treat it as
 * "no subresource" and fall back to a normal patch.
 */
export function normalizeSubresource(subresource?: string): string | undefined {
  if (typeof subresource !== "string") {
    return undefined;
  }
  const trimmed = subresource.trim().replace(/^\/+|\/+$/g, "");
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getResourceHandler(kind: string): ResourceHandler | undefined {
  return RESOURCE_HANDLERS[kind];
}

/**
 * Resolve the apiVersion to use: the explicit one, otherwise the handler default.
 */
export function resolveApiVersion(kind: string, apiVersion?: string): string | undefined {
  return apiVersion ?? getResourceHandler(kind)?.defaultApiVersion;
}

/**
 * Apply the per-kind manifest preparation, defaulting to identity.
 */
export function prepareManifest(kind: string, data: Manifest): Manifest {
  const handler = getResourceHandler(kind);
  return handler?.buildManifest ? handler.buildManifest(data) : data;
}

export type ManifestValidationResult = { success: true; data: Manifest } | { success: false; error: string };

/**
 * Validate a manifest against the per-kind schema when one exists. Unknown kinds
 * (no handler or no schema) pass through unchanged. A valid manifest is also
 * returned unchanged: the schemas list only the required fields, and their
 * parsed output would drop every other field (labels, env, resources, ...).
 */
export function validateManifest(kind: string, data: Manifest): ManifestValidationResult {
  const handler = getResourceHandler(kind);
  if (!handler?.schema) {
    return { success: true, data };
  }
  const errors = Value.Errors(handler.schema, data);
  if (errors.length > 0) {
    const details = errors.map((error) => `${error.instancePath ? `${error.instancePath} ` : ""}${error.message}`);
    return { success: false, error: details.join("; ") };
  }
  return { success: true, data };
}
