import { describe, expect, it } from "vitest";
import {
  buildServiceManifest,
  DEFAULT_DELETE_MODE,
  DELETE_MODES,
  getResourceHandler,
  isDeleteMode,
  isPodDeleteMode,
  isRestartableKind,
  MERGE_PATCH_CONTENT_TYPE,
  normalizeSubresource,
  POD_DELETE_MODES,
  prepareManifest,
  RESTARTABLE_KINDS,
  resolveApiVersion,
  STRATEGIC_MERGE_PATCH_CONTENT_TYPE,
  SUPPORTED_KINDS,
  subresourcePatchContentType,
  validateManifest,
} from "./resource-handlers";

describe("SUPPORTED_KINDS", () => {
  it("lists the internally handled kinds", () => {
    expect(SUPPORTED_KINDS).toEqual(["Pod", "Deployment", "Service"]);
  });
});

describe("RESTARTABLE_KINDS", () => {
  it("lists the workload kinds that expose a rollout restart", () => {
    expect(RESTARTABLE_KINDS).toEqual(["Deployment", "DaemonSet", "StatefulSet"]);
  });
});

describe("isRestartableKind", () => {
  it("accepts restartable workload kinds", () => {
    expect(isRestartableKind("Deployment")).toBe(true);
    expect(isRestartableKind("DaemonSet")).toBe(true);
    expect(isRestartableKind("StatefulSet")).toBe(true);
  });

  it("rejects kinds without a restart endpoint", () => {
    expect(isRestartableKind("Pod")).toBe(false);
    expect(isRestartableKind("Service")).toBe(false);
    expect(isRestartableKind("Gateway")).toBe(false);
  });
});

describe("DELETE_MODES", () => {
  it("mirrors the host KubeObjectDeleteService delete types", () => {
    expect(DELETE_MODES).toEqual(["delete", "force_delete", "force_finalize"]);
  });

  it("defaults to a plain delete", () => {
    expect(DEFAULT_DELETE_MODE).toBe("delete");
    expect(DELETE_MODES).toContain(DEFAULT_DELETE_MODE);
  });
});

describe("isDeleteMode", () => {
  it("accepts the supported delete modes", () => {
    expect(isDeleteMode("delete")).toBe(true);
    expect(isDeleteMode("force_delete")).toBe(true);
    expect(isDeleteMode("force_finalize")).toBe(true);
  });

  it("rejects unknown modes", () => {
    expect(isDeleteMode("evict")).toBe(false);
    expect(isDeleteMode("")).toBe(false);
    expect(isDeleteMode("forceDelete")).toBe(false);
  });
});

describe("POD_DELETE_MODES", () => {
  it("lists the pod-specific deletion variants", () => {
    expect(POD_DELETE_MODES).toEqual(["evict", "force_delete", "delete_with_finalizers"]);
  });
});

describe("isPodDeleteMode", () => {
  it("accepts the supported pod deletion modes", () => {
    expect(isPodDeleteMode("evict")).toBe(true);
    expect(isPodDeleteMode("force_delete")).toBe(true);
    expect(isPodDeleteMode("delete_with_finalizers")).toBe(true);
  });

  it("rejects unknown modes", () => {
    expect(isPodDeleteMode("force_finalize")).toBe(false);
    expect(isPodDeleteMode("delete")).toBe(false);
    expect(isPodDeleteMode("")).toBe(false);
  });
});

describe("normalizeSubresource", () => {
  it("returns undefined when no subresource is given", () => {
    expect(normalizeSubresource(undefined)).toBeUndefined();
    expect(normalizeSubresource("")).toBeUndefined();
    expect(normalizeSubresource("   ")).toBeUndefined();
  });

  it("trims whitespace and surrounding slashes", () => {
    expect(normalizeSubresource("resize")).toBe("resize");
    expect(normalizeSubresource("  resize  ")).toBe("resize");
    expect(normalizeSubresource("/resize")).toBe("resize");
    expect(normalizeSubresource("resize/")).toBe("resize");
    expect(normalizeSubresource("/resize/")).toBe("resize");
  });

  it("keeps an inner path intact", () => {
    expect(normalizeSubresource("status")).toBe("status");
    expect(normalizeSubresource("scale")).toBe("scale");
  });
});

describe("subresourcePatchContentType", () => {
  it("uses a strategic merge patch for resize (array-by-name merge)", () => {
    expect(subresourcePatchContentType("resize")).toBe(STRATEGIC_MERGE_PATCH_CONTENT_TYPE);
    expect(STRATEGIC_MERGE_PATCH_CONTENT_TYPE).toBe("application/strategic-merge-patch+json");
  });

  it("uses a plain merge patch for scale and status", () => {
    expect(subresourcePatchContentType("scale")).toBe(MERGE_PATCH_CONTENT_TYPE);
    expect(subresourcePatchContentType("status")).toBe(MERGE_PATCH_CONTENT_TYPE);
    expect(MERGE_PATCH_CONTENT_TYPE).toBe("application/merge-patch+json");
  });

  it("defaults unknown subresources to the safer plain merge patch", () => {
    expect(subresourcePatchContentType("ephemeralcontainers")).toBe(MERGE_PATCH_CONTENT_TYPE);
    expect(subresourcePatchContentType("")).toBe(MERGE_PATCH_CONTENT_TYPE);
  });
});

describe("getResourceHandler", () => {
  it("returns a handler for a known kind", () => {
    expect(getResourceHandler("Pod")).toBeDefined();
  });

  it("returns undefined for an unknown kind (CRD passthrough)", () => {
    expect(getResourceHandler("Gateway")).toBeUndefined();
  });
});

describe("resolveApiVersion", () => {
  it("prefers the explicit apiVersion", () => {
    expect(resolveApiVersion("Pod", "v2")).toBe("v2");
  });

  it("falls back to the handler default for known kinds", () => {
    expect(resolveApiVersion("Deployment")).toBe("apps/v1");
  });

  it("returns undefined for an unknown kind without an explicit apiVersion", () => {
    expect(resolveApiVersion("Gateway")).toBeUndefined();
  });

  it("returns the explicit apiVersion for an unknown kind", () => {
    expect(resolveApiVersion("Gateway", "gateway.networking.k8s.io/v1")).toBe("gateway.networking.k8s.io/v1");
  });
});

describe("buildServiceManifest", () => {
  it("forces apiVersion and kind", () => {
    const result = buildServiceManifest({ metadata: { name: "svc" }, spec: {} });
    expect(result.apiVersion).toBe("v1");
    expect(result.kind).toBe("Service");
    expect(result.metadata).toEqual({ name: "svc" });
  });

  it("does not mutate the input", () => {
    const input = { kind: "Wrong" };
    buildServiceManifest(input);
    expect(input.kind).toBe("Wrong");
  });
});

describe("prepareManifest", () => {
  it("applies the handler buildManifest for Service", () => {
    const result = prepareManifest("Service", { metadata: { name: "svc" } });
    expect(result.kind).toBe("Service");
  });

  it("returns the manifest unchanged for kinds without a builder", () => {
    const input = { metadata: { name: "pod" } };
    expect(prepareManifest("Pod", input)).toBe(input);
  });

  it("returns the manifest unchanged for unknown kinds", () => {
    const input = { metadata: { name: "gw" } };
    expect(prepareManifest("Gateway", input)).toBe(input);
  });
});

describe("validateManifest", () => {
  it("passes through unknown kinds without validation", () => {
    const input = { anything: true };
    const result = validateManifest("Gateway", input);
    expect(result).toEqual({ success: true, data: input });
  });

  it("validates a well-formed Pod manifest", () => {
    const manifest = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: { name: "p", namespace: "default" },
      spec: { containers: [{ name: "c", image: "nginx", ports: [{ containerPort: 80 }] }] },
    };
    const result = validateManifest("Pod", manifest);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid Pod manifest", () => {
    const result = validateManifest("Pod", { kind: "Pod" });
    expect(result.success).toBe(false);
  });
});
