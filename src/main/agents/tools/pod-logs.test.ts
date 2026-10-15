import { describe, expect, it } from "vitest";
import {
  capLogOutput,
  capTailLines,
  collectContainerNames,
  compileLogFilter,
  errorToText,
  filterLogLines,
  isPreviousContainerNotFoundError,
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

describe("compileLogFilter", () => {
  it("disables filtering for an omitted or empty pattern", () => {
    expect(compileLogFilter(undefined)).toEqual({ kind: "none" });
    expect(compileLogFilter("")).toEqual({ kind: "none" });
  });

  it("compiles a valid pattern into a RegExp", () => {
    const result = compileLogFilter("error|warn");
    expect(result.kind).toBe("regex");
    expect(result.kind === "regex" && result.regex.test("an error happened")).toBe(true);
    expect(result.kind === "regex" && result.regex.test("all good")).toBe(false);
  });

  it("reports an invalid pattern instead of throwing", () => {
    const result = compileLogFilter("(unclosed");
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.message).toContain("(unclosed");
  });
});

describe("filterLogLines", () => {
  it("keeps only matching lines", () => {
    const logs = "info: started\nerror: boom\ninfo: ok\nwarn: careful\n";
    expect(filterLogLines(logs, /error|warn/)).toBe("error: boom\nwarn: careful\n");
  });

  it("preserves the absence of a trailing newline", () => {
    const logs = "error: a\ninfo: b\nerror: c";
    expect(filterLogLines(logs, /error/)).toBe("error: a\nerror: c");
  });

  it("returns an empty string when nothing matches", () => {
    expect(filterLogLines("info: a\ninfo: b\n", /error/)).toBe("");
  });

  it("does not emit a blank line for the trailing newline", () => {
    expect(filterLogLines("match\n", /^/)).toBe("match\n");
  });
});

describe("errorToText", () => {
  it("returns a string error unchanged", () => {
    expect(errorToText("boom")).toBe("boom");
  });

  it("reads the message from an Error instance", () => {
    expect(errorToText(new Error("the failure"))).toBe("the failure");
  });

  it("reads the message from a Kubernetes API error object", () => {
    expect(errorToText({ code: 400, message: "bad request" })).toBe("bad request");
  });

  it("JSON-encodes an object without a message", () => {
    expect(errorToText({ code: 404 })).toBe('{"code":404}');
  });
});

describe("isPreviousContainerNotFoundError", () => {
  it("detects the API message on an Error instance", () => {
    const error = new Error('previous terminated container "app" in pod "web" not found');
    expect(isPreviousContainerNotFoundError(error)).toBe(true);
  });

  it("detects the API message on a Kubernetes error object", () => {
    const error = { code: 400, message: 'previous terminated container "app" in pod "web" not found' };
    expect(isPreviousContainerNotFoundError(error)).toBe(true);
  });

  it("detects the API message on a plain string", () => {
    expect(isPreviousContainerNotFoundError("previous terminated container not found")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isPreviousContainerNotFoundError("Previous Terminated Container ... NOT FOUND")).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isPreviousContainerNotFoundError(new Error("container not found"))).toBe(false);
    expect(isPreviousContainerNotFoundError(new Error("connection refused"))).toBe(false);
    expect(isPreviousContainerNotFoundError({ code: 500 })).toBe(false);
  });
});
