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
