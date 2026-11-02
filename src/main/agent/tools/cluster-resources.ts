// What the approval gate reads of a cluster before it evaluates a kubectl or helm call:
// the resources the cluster serves and the namespace its kubeconfig selects.
// Both are CLI invocations of the gate itself, through the same runner as the
// tool's.

import { DEFAULT_CLI_TIMEOUT_SECONDS } from "../../../common/agent-tools/kubectl-tool";

import type { CliProgram } from "../../../common/invocation-policy/canonical-form";
import type { CatalogResource, ResourceCatalog } from "../../../common/invocation-policy/resource-catalog";
import type { CliRunner } from "../cli-runner";

/** The invocation that lists the resources of the cluster's discovery. */
export const API_RESOURCES_ARGS: readonly string[] = ["api-resources", "-o", "wide"];

/** The invocation that prints the namespace of the kubeconfig's current context, or nothing. */
export const KUBECONFIG_NAMESPACE_ARGS: readonly string[] = [
  "config",
  "view",
  "--minify",
  "-o",
  "jsonpath={..namespace}",
];

/** The namespace of a namespaced target without `-n` when the kubeconfig selects none. */
const FALLBACK_NAMESPACE = "default";

/** What the gate keeps of a cluster for the chat's session. */
export interface ClusterResources {
  catalog: ResourceCatalog;
  defaultNamespace: string;
}

export interface ClusterReadContext {
  clusterId: string;
  runCli: CliRunner;
  signal?: AbortSignal;
  /** What the runner reports before the process starts, such as a kubectl download. */
  onProgress: (message: string) => void;
}

const COLUMNS = ["NAME", "SHORTNAMES", "APIVERSION", "NAMESPACED", "KIND", "VERBS", "CATEGORIES"] as const;
type Column = (typeof COLUMNS)[number];

const splitList = (value: string): string[] => value.split(",").filter(Boolean);

/**
 * The resources of `kubectl api-resources -o wide`. The table is aligned in
 * columns that start where their header starts, and a column may be empty, so
 * each cell is cut out by the header's offsets. Undefined when the output holds
 * no such table.
 */
export function parseApiResources(stdout: string): ResourceCatalog | undefined {
  const [header, ...rows] = stdout.split("\n").filter((line) => line.trim() !== "");
  if (header === undefined) return undefined;
  const starts = new Map<Column, number>();
  for (const match of header.matchAll(/\S+/g)) {
    const column = COLUMNS.find((candidate) => candidate === match[0]);
    if (column) starts.set(column, match.index);
  }
  if (!starts.has("NAME") || !starts.has("APIVERSION") || !starts.has("NAMESPACED") || !starts.has("KIND")) {
    return undefined;
  }
  const offsets = [...starts.values()].sort((a, b) => a - b);
  const cell = (row: string, column: Column): string => {
    const start = starts.get(column);
    if (start === undefined) return "";
    const end = offsets.find((offset) => offset > start);
    return row.slice(start, end).trim();
  };

  return rows.map((row): CatalogResource => {
    const apiVersion = cell(row, "APIVERSION");
    return {
      name: cell(row, "NAME"),
      shortNames: splitList(cell(row, "SHORTNAMES")),
      group: apiVersion.includes("/") ? apiVersion.slice(0, apiVersion.lastIndexOf("/")) : "",
      kind: cell(row, "KIND"),
      namespaced: cell(row, "NAMESPACED") === "true",
      categories: splitList(cell(row, "CATEGORIES")),
    };
  });
}

/** The timeout of the gate's own invocations. */
export const GATE_INVOCATION_TIMEOUT_MS = DEFAULT_CLI_TIMEOUT_SECONDS * 1000;

/** Runs one of the gate's own invocations, with pi's signal for the call and the default timeout. */
export const runGateInvocation = (
  context: ClusterReadContext,
  program: CliProgram,
  args: readonly string[],
  manifest?: string,
) =>
  context.runCli({
    clusterId: context.clusterId,
    program,
    args,
    ...(manifest === undefined ? {} : { manifest }),
    timeoutMs: GATE_INVOCATION_TIMEOUT_MS,
    signal: context.signal,
    onProgress: context.onProgress,
  });

/**
 * The resource catalog of the cluster. kubectl lists what it could discover
 * even when a group version fails and it exits with an error, so the table is
 * used whenever there is one. Throws when there is none.
 */
export async function readResourceCatalog(context: ClusterReadContext): Promise<ResourceCatalog> {
  const result = await runGateInvocation(context, "kubectl", API_RESOURCES_ARGS);
  if (result.killed === "stopped") throw new Error("kubectl api-resources was stopped before it ended");
  if (result.killed === "timeout") throw new Error("kubectl api-resources did not end within its timeout");
  const catalog = parseApiResources(result.stdout);
  if (catalog && catalog.length > 0) return catalog;
  const detail = result.stderr.trim() || `exit code ${result.exitCode}`;
  throw new Error(`kubectl api-resources listed no resources: ${detail}`);
}

/** The namespace the cluster's kubeconfig selects, or `default` when it selects none or cannot be read. */
export async function readDefaultNamespace(context: ClusterReadContext): Promise<string> {
  const result = await runGateInvocation(context, "kubectl", KUBECONFIG_NAMESPACE_ARGS);
  const namespace = result.exitCode === 0 ? result.stdout.trim() : "";
  return /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) ? namespace : FALLBACK_NAMESPACE;
}
