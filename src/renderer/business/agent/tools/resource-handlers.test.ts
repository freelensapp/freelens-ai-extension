import { describe, expect, it } from "vitest";
import {
  buildServiceManifest,
  getResourceHandler,
  isRestartableKind,
  prepareManifest,
  RESTARTABLE_KINDS,
  resolveApiVersion,
  SUPPORTED_KINDS,
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
