import { describe, expect, it } from "vitest";
import { buildFieldSelector, parseFieldPath } from "./field-filter";

const pod = {
  name: "nginx",
  namespace: "default",
  metadata: {
    name: "nginx",
    namespace: "default",
    labels: { app: "nginx", "app.kubernetes.io/name": "nginx" },
  },
  spec: {
    containers: [
      { name: "nginx", image: "nginx:1.25" },
      { name: "sidecar", image: "envoy:1.30" },
    ],
  },
  status: { phase: "Running", podIP: "10.0.0.1" },
};

describe("buildFieldSelector", () => {
  it("returns null when no fields are provided", () => {
    expect(buildFieldSelector(undefined)).toBeNull();
    expect(buildFieldSelector([])).toBeNull();
  });

  it("selects a single dot-notation field, preserving nesting", () => {
    const select = buildFieldSelector([".metadata.name"]);
    expect(select?.(pod)).toEqual({ metadata: { name: "nginx" } });
  });

  it("selects multiple fields into one merged object", () => {
    const select = buildFieldSelector([".metadata.name", ".status.phase"]);
    expect(select?.(pod)).toEqual({
      metadata: { name: "nginx" },
      status: { phase: "Running" },
    });
  });

  it("supports top-level convenience fields", () => {
    const select = buildFieldSelector([".name", ".namespace"]);
    expect(select?.(pod)).toEqual({ name: "nginx", namespace: "default" });
  });

  it("expands a wildcard over array elements", () => {
    const select = buildFieldSelector([".spec.containers[*].image"]);
    expect(select?.(pod)).toEqual({
      spec: { containers: [{ image: "nginx:1.25" }, { image: "envoy:1.30" }] },
    });
  });

  it("selects an explicit array index", () => {
    const select = buildFieldSelector([".spec.containers[0].name"]);
    expect(select?.(pod)).toEqual({ spec: { containers: [{ name: "nginx" }] } });
  });

  it("supports a negative array index", () => {
    const select = buildFieldSelector([".spec.containers[-1].name"]);
    // Serialize to normalize the sparse array (the unmatched index 0 becomes null).
    expect(JSON.parse(JSON.stringify(select?.(pod)))).toEqual({
      spec: { containers: [null, { name: "sidecar" }] },
    });
  });

  it("reads a bracketed quoted key with dots", () => {
    const select = buildFieldSelector([".metadata.labels['app.kubernetes.io/name']"]);
    expect(select?.(pod)).toEqual({
      metadata: { labels: { "app.kubernetes.io/name": "nginx" } },
    });
  });

  it("expands a wildcard over object keys", () => {
    const select = buildFieldSelector([".status.*"]);
    expect(select?.(pod)).toEqual({ status: { phase: "Running", podIP: "10.0.0.1" } });
  });

  it("tolerates kubectl-style wrapping braces and a leading $", () => {
    const select = buildFieldSelector(["{.metadata.name}", "$.status.phase"]);
    expect(select?.(pod)).toEqual({
      metadata: { name: "nginx" },
      status: { phase: "Running" },
    });
  });

  it("tolerates a bare leading key without a dot", () => {
    const select = buildFieldSelector(["metadata.name"]);
    expect(select?.(pod)).toEqual({ metadata: { name: "nginx" } });
  });

  it("skips selectors that do not match anything", () => {
    const select = buildFieldSelector([".metadata.name", ".spec.nonexistent.field"]);
    expect(select?.(pod)).toEqual({ metadata: { name: "nginx" } });
  });

  it("does not mutate the source object", () => {
    const select = buildFieldSelector([".metadata.name"]);
    select?.(pod);
    expect(pod.metadata.labels).toHaveProperty("app", "nginx");
  });
});

describe("parseFieldPath", () => {
  it("throws on an empty selector", () => {
    expect(() => parseFieldPath("   ")).toThrow(/does not reference any field/);
  });

  it("throws on an unterminated bracket", () => {
    expect(() => parseFieldPath(".spec.containers[0")).toThrow(/unterminated/);
  });

  it("throws on empty brackets", () => {
    expect(() => parseFieldPath(".spec.containers[]")).toThrow(/empty/);
  });

  it("validates eagerly through buildFieldSelector", () => {
    expect(() => buildFieldSelector([".metadata.name", "[bad"])).toThrow(/unterminated/);
  });
});
