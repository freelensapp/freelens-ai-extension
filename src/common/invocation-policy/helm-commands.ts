// The command line of helm, as `helm <command> --help` of helm 4.3 documents
// it, for the verbs the agent may run: the reads of releases and charts
// (`list`, `status`, `history`, `get values`, `get manifest`, `get notes`,
// `show`, `search repo`) and the changes of releases (`rollback`, `uninstall`,
// `upgrade`). The parser accepts nothing else. `upgrade` takes only
// `--reuse-values`, `--set` and `--dry-run`, so that it changes the values of a
// release and nothing more; every other flag of it is left out on purpose.

import { type FlagSpec, flag, flags } from "./cli-flags";

import type { CliFloorCommand } from "./cli-invocation";

/** What the positional arguments of a helm command are, past its verb words. */
export type HelmOperands =
  /** No release or chart is named: every release (`list`) or every chart that matches (`search repo`), up to `max` arguments. */
  | { kind: "all"; resource: "releases" | "charts"; max: number }
  /** One release, then up to `revision` revision numbers (`rollback RELEASE [REVISION]`). */
  | { kind: "release"; revision?: number }
  /** One or more releases (`uninstall`). */
  | { kind: "releases" }
  /** One chart of a repository (`show values CHART`). */
  | { kind: "chart" }
  /** A release and the chart it is upgraded to (`upgrade RELEASE CHART`). */
  | { kind: "release and chart" };

export interface HelmCommand {
  /** The words that name the command: `["get", "values"]`. */
  path: readonly string[];
  /** The verb of its canonical forms; the subcommands of `show` share theirs. */
  verb: string;
  flags: readonly FlagSpec[];
  operands: HelmOperands;
  /** The flags that must be set, with why. */
  requiredFlags?: readonly { long: string; reason: string }[];
}

const IDENTITY = "cluster-or-identity";
const CREDENTIALS = "credentials-or-configuration";
const DISK = "local-disk-or-code";

export const HELM_GLOBAL_FLAGS: readonly FlagSpec[] = flags(
  flag("--kube-apiserver=", IDENTITY),
  flag("--kube-as-group=", IDENTITY),
  flag("--kube-as-user=", IDENTITY),
  flag("--kube-ca-file=", IDENTITY),
  flag("--kube-context=", IDENTITY),
  flag("--kube-insecure-skip-tls-verify", IDENTITY),
  flag("--kube-tls-server-name=", IDENTITY),
  flag("--kube-token=", IDENTITY),
  flag("--kubeconfig=", IDENTITY),
  flag("--content-cache=", DISK),
  flag("--registry-config=", DISK),
  flag("--repository-cache=", DISK),
  flag("--repository-config=", DISK),
  "--burst-limit=",
  "--color=",
  "--colour=",
  "--debug",
  "-h|--help",
  "-n|--namespace=",
  "--qps=",
);

/** Flags that read the user's disk or run local code, on any command that has them or not. */
const LOCAL_FILES = flags(
  flag("-f|--values=", DISK),
  flag("--set-file=", DISK),
  flag("--post-renderer=", DISK),
  flag("--post-renderer-args=", DISK),
  flag("--repo=", DISK),
  flag("--ca-file=", DISK),
  flag("--cert-file=", DISK),
  flag("--key-file=", DISK),
  flag("--keyring=", DISK),
);

/**
 * Flags of the floor that a command may not have: helm would reject them as
 * unknown, and the floor names why they are never allowed.
 */
export const HELM_FLOOR_ONLY_FLAGS: readonly FlagSpec[] = LOCAL_FILES;

const OUTPUT = flags("-o|--output=");
const REVISION = flags("--revision=");
/** `--dry-run` of `upgrade` and `rollback`, whose value is optional. */
const DRY_RUN = flags("--dry-run");
/** The flags of `show` that find its chart; those that name a file or a repository URL are rejected by the floor. */
const CHART_LOOKUP = flags(
  flag("--ca-file=", DISK),
  flag("--cert-file=", DISK),
  flag("--key-file=", DISK),
  flag("--keyring=", DISK),
  flag("--repo=", DISK),
  "--devel",
  "--version=",
);

const command = (
  path: string,
  flagSpecs: readonly FlagSpec[],
  operands: HelmOperands,
  extra: Partial<HelmCommand> = {},
): HelmCommand => ({ path: path.split(" "), verb: path, flags: flagSpecs, operands, ...extra });

const showCommand = (path: string, flagSpecs: readonly FlagSpec[] = []) =>
  command(`show ${path}`, flags(CHART_LOOKUP, flagSpecs), { kind: "chart" }, { verb: "show" });

export const HELM_COMMANDS: readonly HelmCommand[] = [
  command(
    "list",
    flags(
      OUTPUT,
      "-A|--all-namespaces",
      "-d|--date",
      "--deployed",
      "--failed",
      "-f|--filter=",
      "-m|--max=",
      "--no-headers",
      "--offset=",
      "--pending",
      "-r|--reverse",
      "-l|--selector=",
      "-q|--short",
      "--superseded",
      "--time-format=",
      "--uninstalled",
      "--uninstalling",
    ),
    { kind: "all", resource: "releases", max: 0 },
  ),
  command("status", flags(OUTPUT, REVISION), { kind: "release" }),
  command("history", flags(OUTPUT, "--max=", "--show-rollback-revision"), { kind: "release" }),
  command("get values", flags(OUTPUT, REVISION, "-a|--all"), { kind: "release" }),
  command("get manifest", REVISION, { kind: "release" }),
  command("get notes", REVISION, { kind: "release" }),
  showCommand("all"),
  showCommand("chart"),
  showCommand("crds"),
  showCommand("readme"),
  showCommand("values", flags("--jsonpath=")),
  command(
    "search repo",
    flags(OUTPUT, "--devel", "--fail-on-no-result", "--max-col-width=", "-r|--regexp", "--version=", "-l|--versions"),
    { kind: "all", resource: "charts", max: 1 },
  ),
  command(
    "rollback",
    flags(
      DRY_RUN,
      "--cleanup-on-fail",
      "--description=",
      "--force-conflicts",
      "--force-replace",
      "--history-max=",
      "--no-hooks",
      "--server-side=",
      "--timeout=",
      "--wait",
      "--wait-for-jobs",
    ),
    { kind: "release", revision: 1 },
  ),
  command(
    "uninstall",
    flags(
      "--cascade=",
      "--description=",
      "--dry-run",
      "--ignore-not-found",
      "--keep-history",
      "--no-hooks",
      "--timeout=",
      "--wait",
    ),
    { kind: "releases" },
  ),
  command(
    "upgrade",
    flags(DRY_RUN, LOCAL_FILES, "--reuse-values", "--set="),
    { kind: "release and chart" },
    {
      requiredFlags: [
        {
          long: "--reuse-values",
          reason: "so that it keeps the values of the release and changes only those that --set gives",
        },
      ],
    },
  ),
];

/** Commands the floor rejects whatever their arguments are. */
export const HELM_FLOOR_COMMANDS: readonly CliFloorCommand[] = [
  { path: ["registry", "login"], floor: CREDENTIALS },
  { path: ["repo", "add"], floor: CREDENTIALS },
  { path: ["repo", "index"], floor: DISK },
  { path: ["plugin"], floor: DISK },
  { path: ["pull"], floor: DISK },
  { path: ["push"], floor: DISK },
  { path: ["package"], floor: DISK },
  { path: ["create"], floor: DISK },
  { path: ["lint"], floor: DISK },
  { path: ["dependency"], floor: DISK },
  { path: ["verify"], floor: DISK },
];

/** Verbs of helm that the parser does not take, so that helm does not look for a plugin of that name. */
export const HELM_UNSUPPORTED_VERBS: readonly string[] = [
  "completion",
  "env",
  "help",
  "install",
  "template",
  "test",
  "version",
];

/** The aliases of command words, by the path of the command they belong to. */
export const HELM_COMMAND_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "": {
    del: "uninstall",
    delete: "uninstall",
    dep: "dependency",
    dependencies: "dependency",
    fetch: "pull",
    hist: "history",
    inspect: "show",
    ls: "list",
    un: "uninstall",
  },
};
