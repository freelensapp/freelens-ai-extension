import { describe, expect, it } from "vitest";
import {
  capLogOutput,
  capTailLines,
  collectContainerNames,
  MAX_TAIL_LINES,
  resolveContainer,
  TRUNCATION_MARKER,
} from "./pod-logs";

describe("collectContainerNames", () => {
  it("collects names from containers, initContainers and ephemeralContainers", () => {
    const spec = {
      containers: [{ name: "app" }, { name: "sidecar" }],
      initContainers: [{ name: "init" }],
      ephemeralContainers: [{ name: "debug" }],
    };
    expect(collectContainerNames(spec)).toEqual({
      containers: ["app", "sidecar"],
      initContainers: ["init"],
      ephemeralContainers: ["debug"],
    });
  });

  it("ignores entries without a string name and missing arrays", () => {
    const spec = { containers: [{ name: "app" }, {}, { name: 5 }, null] };
    expect(collectContainerNames(spec)).toEqual({
      containers: ["app"],
      initContainers: [],
      ephemeralContainers: [],
    });
  });

  it("handles a non-object spec", () => {
    expect(collectContainerNames(undefined)).toEqual({
      containers: [],
      initContainers: [],
      ephemeralContainers: [],
    });
  });
});

describe("resolveContainer", () => {
  const names = { containers: ["app", "sidecar"], initContainers: ["init"], ephemeralContainers: [] };

  it("resolves the only container when none is requested", () => {
    expect(resolveContainer(undefined, { containers: ["solo"], initContainers: [], ephemeralContainers: [] })).toEqual({
      kind: "resolved",
      container: "solo",
    });
  });

  it("asks which container to use for a multi-container pod", () => {
    const result = resolveContainer(undefined, names);
    expect(result.kind).toBe("ask");
    expect(result.kind === "ask" && result.message).toContain("app");
    expect(result.kind === "ask" && result.message).toContain("sidecar");
  });

  it("resolves a requested container including init containers", () => {
    expect(resolveContainer("init", names)).toEqual({ kind: "resolved", container: "init" });
  });

  it("errors when the requested container does not exist", () => {
    const result = resolveContainer("missing", names);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.message).toContain("app");
  });

  it("errors when the pod has no containers", () => {
    const result = resolveContainer(undefined, { containers: [], initContainers: [], ephemeralContainers: [] });
    expect(result.kind).toBe("error");
  });
});

describe("capTailLines", () => {
  it("uses the requested value when valid", () => {
    expect(capTailLines(500, 1000)).toBe(500);
  });

  it("falls back to the configured default when the request is missing or invalid", () => {
    expect(capTailLines(undefined, 1000)).toBe(1000);
    expect(capTailLines(0, 1000)).toBe(1000);
    expect(capTailLines(-5, 1000)).toBe(1000);
    expect(capTailLines(Number.NaN, 1000)).toBe(1000);
  });

  it("hard-caps the value regardless of request or configuration", () => {
    expect(capTailLines(MAX_TAIL_LINES + 1, 1000)).toBe(MAX_TAIL_LINES);
    expect(capTailLines(undefined, MAX_TAIL_LINES + 1000)).toBe(MAX_TAIL_LINES);
  });

  it("floors fractional values", () => {
    expect(capTailLines(10.9, 1000)).toBe(10);
  });
});

describe("capLogOutput", () => {
  it("returns short logs unchanged", () => {
    expect(capLogOutput("hello world", 1024)).toBe("hello world");
  });

  it("keeps the tail and prepends the truncation marker when over the byte cap", () => {
    const logs = "a".repeat(100);
    const result = capLogOutput(logs, 10);
    expect(result.startsWith(TRUNCATION_MARKER)).toBe(true);
    expect(result.endsWith("a".repeat(10))).toBe(true);
    expect(result).not.toBe(logs);
  });

  it("measures multi-byte characters by bytes", () => {
    // Each "€" is 3 bytes; 10 of them is 30 bytes, over a 12-byte cap.
    const logs = "€".repeat(10);
    const result = capLogOutput(logs, 12);
    expect(result.startsWith(TRUNCATION_MARKER)).toBe(true);
  });
});
