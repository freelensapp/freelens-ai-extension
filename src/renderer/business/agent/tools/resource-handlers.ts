import { z } from "zod";

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
  schema?: z.ZodTypeAny;
  /**
   * Special-case manifest preparation (for example forcing `apiVersion`/`kind`).
   * Defaults to identity for kinds without one. This is where resource-specific
   * business logic (a `buildPodManifest`-style helper) can live.
   */
  buildManifest?: (data: Manifest) => Manifest;
}

export const podManifestSchema = z
  .object({
    apiVersion: z.string(),
    kind: z.string(),
    metadata: z.object({
      name: z.string(),
      namespace: z.string(),
    }),
    spec: z.object({
      containers: z.array(
        z.object({
          name: z.string(),
          image: z.string(),
          ports: z.array(
            z.object({
              containerPort: z.number(),
            }),
          ),
        }),
      ),
    }),
  })
  .describe("Pod K8S manifest");

export const deploymentManifestSchema = z
  .object({
    apiVersion: z.string(),
    kind: z.string(),
    metadata: z.object({
      name: z.string(),
      namespace: z.string(),
    }),
    spec: z.object({
      replicas: z.number(),
      selector: z.object({
        matchLabels: z.record(z.string()),
      }),
      template: z.object({
        metadata: z.object({
          labels: z.record(z.string()),
        }),
        spec: z.object({
          containers: z.array(
            z.object({
              name: z.string(),
              image: z.string(),
              ports: z.array(
                z.object({
                  containerPort: z.number(),
                }),
              ),
            }),
          ),
        }),
      }),
    }),
  })
  .describe("Deployment K8S manifest");

export const serviceManifestSchema = z
  .object({
    apiVersion: z.string(),
    kind: z.string(),
    metadata: z.object({
      name: z.string(),
      namespace: z.string().optional(),
      labels: z.record(z.string()).optional(),
      annotations: z.record(z.string()).optional(),
    }),
    spec: z.object({
      type: z.enum(["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"]).optional(),
      selector: z.record(z.string()).optional(),
      ports: z.array(
        z.object({
          name: z.string().optional(),
          protocol: z.enum(["TCP", "UDP", "SCTP"]).optional().default("TCP"),
          port: z.number().int().min(1).max(65535),
          targetPort: z.union([z.number().int().min(1).max(65535), z.string()]),
          nodePort: z.number().int().min(30000).max(32767).optional(),
        }),
      ),
      clusterIP: z.string().optional(),
      externalName: z.string().optional(),
      sessionAffinity: z.enum(["None", "ClientIP"]).optional(),
      ipFamilyPolicy: z.enum(["SingleStack", "PreferDualStack", "RequireDualStack"]).optional(),
      ipFamilies: z.array(z.string()).optional(),
    }),
  })
  .describe("Service K8S manifest");

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

/**
 * Kubernetes content-type for a strategic merge patch. Used for subresources
 * whose payload updates entries inside arrays merged by a key (for example the
 * Pod `resize` subresource, which merges `spec.containers` by `name`); a plain
 * JSON merge patch would replace the whole array.
 */
export const STRATEGIC_MERGE_PATCH_CONTENT_TYPE = "application/strategic-merge-patch+json";

/**
 * Kubernetes content-type for a plain JSON merge patch (RFC 7386). Used for
 * subresources that do not register a strategic merge strategy, such as `scale`
 * (a Scale object) and `status`, where the apiserver rejects a strategic merge
 * patch.
 */
export const MERGE_PATCH_CONTENT_TYPE = "application/merge-patch+json";

/**
 * Subresources whose patch payload requires a strategic merge patch (array
 * entries merged by key). Only the Pod `resize` subresource needs this today;
 * every other subresource (`scale`, `status`, ...) uses a plain merge patch.
 */
const STRATEGIC_MERGE_PATCH_SUBRESOURCES = new Set<string>(["resize"]);

/**
 * Pick the PATCH content-type for a subresource. The Pod `resize` subresource
 * merges `spec.containers` by name and needs a strategic merge patch; `scale`
 * (a Scale object) and `status` have no strategic merge strategy registered, so
 * they require a plain JSON merge patch (the apiserver rejects a strategic merge
 * there). Unknown subresources default to the safer plain merge patch.
 */
export function subresourcePatchContentType(subresource: string): string {
  return STRATEGIC_MERGE_PATCH_SUBRESOURCES.has(subresource)
    ? STRATEGIC_MERGE_PATCH_CONTENT_TYPE
    : MERGE_PATCH_CONTENT_TYPE;
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
 * (no handler or no schema) pass through unchanged.
 */
export function validateManifest(kind: string, data: Manifest): ManifestValidationResult {
  const handler = getResourceHandler(kind);
  if (!handler?.schema) {
    return { success: true, data };
  }
  const result = handler.schema.safeParse(data);
  if (!result.success) {
    return { success: false, error: result.error.message };
  }
  return { success: true, data: result.data as Manifest };
}
