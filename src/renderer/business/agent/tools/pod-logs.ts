export interface GetPodLogsInput {
  name: string;
  namespace: string;
  container?: string;
  previous?: boolean;
  tailLines?: number;
  timestamps?: boolean;
  filter?: string;
}

// Hard cap on the bytes returned to the model so a chatty pod cannot overflow
// the model context. The most recent (tail) portion is kept.
export const MAX_LOG_BYTES = 256 * 1024;
// Hard cap on tail lines regardless of the configured/requested value.
export const MAX_TAIL_LINES = 10000;
export const TRUNCATION_MARKER = "...[truncated]...\n";

export interface PodContainerNames {
  containers: string[];
  initContainers: string[];
  ephemeralContainers: string[];
}

export type ContainerResolution =
  | { kind: "resolved"; container: string }
  | { kind: "ask"; message: string }
  | { kind: "error"; message: string };

/**
 * Collect the container names declared on a pod spec. The spec is typed as
 * `unknown` because the generic host store does not narrow it to a Pod; the
 * shape is validated at runtime here (no instance methods, per the CRD rule).
 */
export function collectContainerNames(spec: unknown): PodContainerNames {
  const readNames = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => (entry && typeof entry === "object" ? (entry as { name?: unknown }).name : undefined))
      .filter((name): name is string => typeof name === "string" && name.length > 0);
  };

  const podSpec = spec && typeof spec === "object" ? (spec as Record<string, unknown>) : {};
  return {
    containers: readNames(podSpec.containers),
    initContainers: readNames(podSpec.initContainers),
    ephemeralContainers: readNames(podSpec.ephemeralContainers),
  };
}

/**
 * Decide which container's logs to read. When the container is omitted on a
 * multi-container pod the model is asked to pick one instead of guessing.
 */
export function resolveContainer(requested: string | undefined, names: PodContainerNames): ContainerResolution {
  const allNames = [...names.containers, ...names.initContainers, ...names.ephemeralContainers];

  if (requested) {
    if (allNames.includes(requested)) {
      return { kind: "resolved", container: requested };
    }
    return {
      kind: "error",
      message: `Container "${requested}" was not found in the pod. Available containers: ${allNames.join(", ") || "(none)"}.`,
    };
  }

  if (allNames.length === 0) {
    return { kind: "error", message: "The pod has no containers to read logs from." };
  }
  if (allNames.length === 1) {
    return { kind: "resolved", container: allNames[0] };
  }
  return {
    kind: "ask",
    message: `The pod has multiple containers; specify which one to read. Available containers: ${allNames.join(", ")}.`,
  };
}

/**
 * Clamp the tail-lines value to a sane, hard-capped range, falling back to the
 * configured default when the requested value is missing or invalid.
 */
export function capTailLines(requested: number | undefined, configured: number): number {
  const fallback = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : MAX_TAIL_LINES;
  const base = typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? requested : fallback;
  return Math.min(Math.floor(base), MAX_TAIL_LINES);
}

/**
 * Byte-cap the log output, keeping the most recent (tail) portion and marking
 * the truncation. Measured with TextEncoder so multi-byte characters count
 * correctly.
 */
export function capLogOutput(logs: string, maxBytes: number = MAX_LOG_BYTES): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(logs);
  if (bytes.length <= maxBytes) {
    return logs;
  }
  const tail = bytes.slice(bytes.length - maxBytes);
  // A byte-slice may start in the middle of a multi-byte character; the decoder
  // replaces the partial leading bytes gracefully.
  const decoded = new TextDecoder().decode(tail);
  return TRUNCATION_MARKER + decoded;
}

/**
 * Build the message returned when a pod produced no log output, hinting at the
 * previous-instance option for containers that have not started yet.
 */
export function emptyLogsMessage(container: string, name: string, previous: boolean | undefined): string {
  return previous
    ? `No previous logs for container "${container}" in pod "${name}". The container may not have a terminated instance.`
    : `No logs for container "${container}" in pod "${name}". The container may not have started yet; try previous: true to read the last terminated instance.`;
}

export type LogFilterResolution =
  | { kind: "none" }
  | { kind: "regex"; regex: RegExp }
  | { kind: "error"; message: string };

/**
 * Compile the optional log-line filter into a RegExp. An empty/omitted pattern
 * disables filtering; an invalid pattern is reported back to the model instead
 * of throwing so it can correct the expression.
 */
export function compileLogFilter(pattern: string | undefined): LogFilterResolution {
  if (pattern === undefined || pattern === "") {
    return { kind: "none" };
  }
  try {
    return { kind: "regex", regex: new RegExp(pattern) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { kind: "error", message: `Invalid filter regular expression "${pattern}": ${reason}` };
  }
}

/**
 * Keep only the log lines matching the regex (grep-style). A trailing newline
 * on the input is preserved on the output so the result still reads like a log.
 */
export function filterLogLines(logs: string, regex: RegExp): string {
  const hadTrailingNewline = logs.endsWith("\n");
  const lines = logs.split("\n");
  if (hadTrailingNewline) {
    // Drop the empty element produced by the trailing newline so it is not
    // tested against the filter or re-emitted as a blank line.
    lines.pop();
  }
  const matched = lines.filter((line) => regex.test(line));
  if (matched.length === 0) {
    return "";
  }
  return matched.join("\n") + (hadTrailingNewline ? "\n" : "");
}

/**
 * Build the message returned when a filter was applied but no log line matched.
 */
export function noMatchingLogsMessage(container: string, name: string, filter: string): string {
  return `No log lines for container "${container}" in pod "${name}" matched the filter /${filter}/.`;
}
