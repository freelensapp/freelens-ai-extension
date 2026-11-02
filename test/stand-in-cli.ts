// A stand-in for the CLI runner of main, for the tests of the agent host. It
// records every CLI invocation and answers it by its arguments, so a test
// asserts what would have run without a cluster or a kubectl binary.

import { API_RESOURCES_ARGS, KUBECONFIG_NAMESPACE_ARGS } from "../src/main/agent/tools/cluster-resources";

import type { CliInvocation, CliResult, CliRunner } from "../src/main/agent/cli-runner";

/** A CLI invocation as the stand-in received it. */
export type RecordedInvocation = Omit<CliInvocation, "onProgress">;

/** The key of the gate's read of the cluster's resources. */
export const API_RESOURCES_KEY = API_RESOURCES_ARGS.join(" ");
/** The key of the gate's read of the kubeconfig's namespace. */
export const KUBECONFIG_NAMESPACE_KEY = KUBECONFIG_NAMESPACE_ARGS.join(" ");

type ResourceRow = [name: string, shortNames: string, apiVersion: string, namespaced: boolean, kind: string];

const VERBS = "create,delete,deletecollection,get,list,patch,update,watch";

/**
 * `kubectl api-resources -o wide` as kubectl prints it: columns padded to their
 * widest cell plus three spaces, empty cells left blank.
 */
export const apiResourcesTable = (rows: readonly ResourceRow[], categories: Record<string, string> = {}): string => {
  const cells = [
    ["NAME", "SHORTNAMES", "APIVERSION", "NAMESPACED", "KIND", "VERBS", "CATEGORIES"],
    ...rows.map(([name, shortNames, apiVersion, namespaced, kind]) => [
      name,
      shortNames,
      apiVersion,
      String(namespaced),
      kind,
      VERBS,
      categories[name] ?? "",
    ]),
  ];
  const widths = cells[0]!.map((_, column) => Math.max(...cells.map((row) => row[column]!.length)) + 3);
  return cells
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!)))
        .join("")
        .trimEnd(),
    )
    .map((line) => `${line}\n`)
    .join("");
};

/** The resources of the stand-in cluster: some built-in kinds and Flux's Kustomization. */
export const STAND_IN_RESOURCES: readonly ResourceRow[] = [
  ["configmaps", "cm", "v1", true, "ConfigMap"],
  ["events", "ev", "v1", true, "Event"],
  ["namespaces", "ns", "v1", false, "Namespace"],
  ["nodes", "no", "v1", false, "Node"],
  ["pods", "po", "v1", true, "Pod"],
  ["secrets", "", "v1", true, "Secret"],
  ["services", "svc", "v1", true, "Service"],
  ["customresourcedefinitions", "crd,crds", "apiextensions.k8s.io/v1", false, "CustomResourceDefinition"],
  ["deployments", "deploy", "apps/v1", true, "Deployment"],
  ["replicasets", "rs", "apps/v1", true, "ReplicaSet"],
  ["clusterroles", "", "rbac.authorization.k8s.io/v1", false, "ClusterRole"],
  ["kustomizations", "ks", "kustomize.toolkit.fluxcd.io/v1", true, "Kustomization"],
];

export const STAND_IN_API_RESOURCES = apiResourcesTable(STAND_IN_RESOURCES, {
  pods: "all",
  services: "all",
  deployments: "all",
  replicasets: "all",
});

export interface StandInCliOptions {
  /**
   * What an invocation answers, by its arguments joined with spaces
   * (`"get pods -n web"`); unset fields are empty, with exit code 0. An
   * invocation without an answer fails as kubectl does for an unknown command,
   * with exit code 1. Read when the invocation arrives, so a test may change
   * an answer between two calls. `API_RESOURCES_KEY` answers with
   * `STAND_IN_API_RESOURCES` and `KUBECONFIG_NAMESPACE_KEY` with no namespace
   * unless set here.
   */
  answers?: Record<string, Partial<CliResult>>;
  /** Invocations, by the same key, that answer only once their signal aborts, as the runner does on Stop. */
  hang?: readonly string[];
  /**
   * The progress messages the first invocation reports before it answers, as
   * a kubectl download does: Freelens downloads the cluster's kubectl once.
   */
  progress?: readonly string[];
}

const DISCOVERY_KEYS: readonly string[] = [API_RESOURCES_KEY, KUBECONFIG_NAMESPACE_KEY];

/**
 * Whether an invocation is one of the gate's previews: a server-side dry run,
 * or a read of a target's current object (`get <resource> <name> -n <ns> -o
 * yaml`). An agent's own read in that exact form counts as one too, so the
 * tests of the agent's reads use another output.
 */
const isPreview = ({ args }: RecordedInvocation) =>
  args.includes("--dry-run=server") || /^get \S+ \S+( -n \S+)? -o yaml$/.test(args.join(" "));

export function createStandInCli({ answers = {}, hang = [], progress = [] }: StandInCliOptions = {}) {
  const invocations: RecordedInvocation[] = [];
  const defaults: Record<string, Partial<CliResult>> = {
    [API_RESOURCES_KEY]: { stdout: STAND_IN_API_RESOURCES },
    [KUBECONFIG_NAMESPACE_KEY]: { stdout: "" },
  };

  const run: CliRunner = async ({ onProgress, ...invocation }) => {
    invocations.push(invocation);
    if (invocations.length === 1) for (const message of progress) onProgress(message);
    const key = invocation.args.join(" ");
    if (hang.includes(key)) {
      return new Promise<CliResult>((resolve) => {
        const stopped = () => resolve({ stdout: "", stderr: "", exitCode: null, killed: "stopped" });
        if (invocation.signal?.aborted) stopped();
        invocation.signal?.addEventListener("abort", stopped, { once: true });
      });
    }
    const answer = answers[key] ?? defaults[key];
    if (!answer) {
      return { stdout: "", stderr: `error: the stand-in CLI has no answer for "${key}"\n`, exitCode: 1 };
    }
    return { stdout: "", stderr: "", exitCode: 0, ...answer };
  };

  /** The invocations other than the gate's own: its reads of the cluster's resources and namespace, and its previews. */
  const actions = () =>
    invocations.filter((invocation) => !DISCOVERY_KEYS.includes(invocation.args.join(" ")) && !isPreview(invocation));
  /** The gate's previews: its dry runs and its reads of the current objects. */
  const previews = () => invocations.filter(isPreview);

  return { run, invocations, actions, previews };
}
