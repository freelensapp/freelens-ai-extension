// The command line of kubectl, as `kubectl <command> --help` of kubectl 1.36
// documents it: the global flags, the verbs and their subcommands, the flags of
// each and the arguments each takes. The parser accepts nothing else, so a
// flag that is missing here is rejected as not supported rather than guessed.
// `--raw`, `apply --prune` and `set env --resolve` are left out on purpose:
// they reach objects the canonical forms would not name.

import type { FloorEntryId } from "./floor";

export interface FlagSpec {
  /** `--output`. */
  long: string;
  /** `-o`. */
  short?: string;
  /**
   * Whether the flag takes the next argument as its value. Boolean flags, and
   * flags whose value is optional (`--dry-run`, `--cascade`, `--validate`),
   * take a value only after `=`.
   */
  takesValue: boolean;
  /** The floor entry that rejects the flag when it is set; a boolean flag set to `false` is not. */
  floor?: FloorEntryId;
  /** Whether the floor rejects this value; every value when absent. */
  floorRejects?: (value: string) => boolean;
}

/** What the positional arguments of a command are, past its verb words. */
export type KubectlOperands =
  /** No positional argument. */
  | { kind: "none" }
  /**
   * kubectl's resource arguments: `TYPE[,TYPE...] [NAME...]` or
   * `TYPE/NAME...`, followed by `pairs` (label changes, images, taints) or
   * by `trailing` arguments (a selector, a service account).
   */
  | { kind: "targets"; pairs?: (argument: string) => boolean; trailing?: number }
  /** `POD` or `TYPE/NAME`, then up to `extra` more arguments (the container of `logs`). */
  | { kind: "workload"; resource: string; extra: number }
  /** Names of one resource: `cordon NODE`, `top pod [NAME]`; `max` limits them. */
  | { kind: "names"; resource: string; max?: number }
  /** The one name of the object a command creates. */
  | { kind: "name"; resource: string }
  /** Arguments that are not targets: the field path of `explain`, the question of `auth can-i`. */
  | { kind: "free"; max: number };

export interface KubectlCommand {
  /** The words that name the command: `["rollout", "restart"]`. */
  path: readonly string[];
  /** The verb of its canonical forms; the subcommands of `create`, `set` and `top` share theirs. */
  verb: string;
  flags: readonly FlagSpec[];
  operands: KubectlOperands;
  /** Whether it takes the `manifest` parameter. */
  takesManifest?: boolean;
  /** Whether it takes a command after `--`. */
  takesCommand?: boolean;
  /** The flags that select every object of the target resources, which makes the name `*`. */
  selectors?: readonly string[];
}

/** A command the floor rejects whatever its arguments are. */
export interface KubectlFloorCommand {
  path: readonly string[];
  floor: FloorEntryId;
}

/**
 * `"-o|--output="`: the short and the long spelling, and a trailing `=` when
 * the flag takes the next argument as its value.
 */
const flag = (spelling: string, floor?: FloorEntryId, floorRejects?: (value: string) => boolean): FlagSpec => {
  const takesValue = spelling.endsWith("=");
  const names = (takesValue ? spelling.slice(0, -1) : spelling).split("|");
  const long = names.find((name) => name.startsWith("--")) ?? "";
  const short = names.find((name) => !name.startsWith("--"));
  return {
    long,
    ...(short ? { short } : {}),
    takesValue,
    ...(floor ? { floor } : {}),
    ...(floorRejects ? { floorRejects } : {}),
  };
};

const flags = (...specs: readonly (string | FlagSpec | readonly FlagSpec[])[]): FlagSpec[] =>
  specs.flatMap((spec) => (typeof spec === "string" ? [flag(spec)] : Array.isArray(spec) ? spec : [spec as FlagSpec]));

const IDENTITY = "cluster-or-identity";
const CREDENTIALS = "credentials-or-configuration";
const DISK = "local-disk-or-code";
const NEVER_ENDS = "never-ends-or-terminal";

/** Verbosity 6 and up logs request headers and response bodies. */
const isVerboseLogging = (value: string): boolean => !/^\d+$/.test(value) || Number(value) >= 6;

export const KUBECTL_GLOBAL_FLAGS: readonly FlagSpec[] = flags(
  flag("--as=", IDENTITY),
  flag("--as-group=", IDENTITY),
  flag("--as-uid=", IDENTITY),
  flag("--as-user-extra=", IDENTITY),
  flag("--cache-dir=", IDENTITY),
  flag("--certificate-authority=", IDENTITY),
  flag("--client-certificate=", IDENTITY),
  flag("--client-key=", IDENTITY),
  flag("--cluster=", IDENTITY),
  flag("--context=", IDENTITY),
  flag("--insecure-skip-tls-verify", IDENTITY),
  flag("--kubeconfig=", IDENTITY),
  flag("--password=", IDENTITY),
  flag("-s|--server=", IDENTITY),
  flag("--tls-server-name=", IDENTITY),
  flag("--token=", IDENTITY),
  flag("--user=", IDENTITY),
  flag("--username=", IDENTITY),
  flag("--kuberc=", DISK),
  flag("--profile=", DISK),
  flag("--profile-output=", DISK),
  flag("-v|--v=", CREDENTIALS, isVerboseLogging),
  flag("--vmodule=", CREDENTIALS),
  "--disable-compression",
  "-h|--help",
  "--log-flush-frequency=",
  "--match-server-version",
  "-n|--namespace=",
  "--request-timeout=",
  "--warnings-as-errors",
);

/**
 * Flags of the floor that a command may not have: kubectl would reject them
 * as unknown, and the floor names why they are never allowed.
 */
export const KUBECTL_FLOOR_ONLY_FLAGS: readonly FlagSpec[] = flags(
  flag("-f|--filename=", DISK),
  flag("-k|--kustomize=", DISK),
  flag("--from-file=", DISK),
  flag("--from-env-file=", DISK),
  flag("-i|--stdin", NEVER_ENDS),
  flag("-t|--tty", NEVER_ENDS),
  flag("-w|--watch", NEVER_ENDS),
  flag("--follow", NEVER_ENDS),
);

const OUTPUT = flags("-o|--output=", "--template=", "--allow-missing-template-keys", "--show-managed-fields");
const FILES = flags(flag("-f|--filename=", DISK), flag("-k|--kustomize=", DISK), "-R|--recursive");
const SELECTOR = flags("-l|--selector=");
const FIELD_SELECTOR = flags("--field-selector=");
const ALL_NAMESPACES = flags("-A|--all-namespaces");
const DRY_RUN = flags("--dry-run");
const FIELD_MANAGER = flags("--field-manager=");
const VALIDATE = flags("--validate");
const WATCH = flags(flag("-w|--watch", NEVER_ENDS));
const STDIN_AND_TTY = flags(flag("-i|--stdin", NEVER_ENDS), flag("-t|--tty", NEVER_ENDS));
const CREATE_SUBCOMMAND = flags(OUTPUT, DRY_RUN, FIELD_MANAGER, VALIDATE, "--save-config");

const NONE: KubectlOperands = { kind: "none" };
const TARGETS: KubectlOperands = { kind: "targets" };
/** `KEY=VALUE` and `KEY-` of label, annotate, set env and set image. */
const isKeyChange = (argument: string): boolean => argument.includes("=") || argument.endsWith("-");
/** `KEY=VALUE:EFFECT`, `KEY:EFFECT` and `KEY-` of taint. */
const isTaint = (argument: string): boolean => isKeyChange(argument) || argument.includes(":");

const command = (
  path: string,
  flagSpecs: readonly FlagSpec[],
  operands: KubectlOperands,
  extra: Partial<KubectlCommand> = {},
): KubectlCommand => ({
  path: path.split(" "),
  verb: path,
  flags: flagSpecs,
  operands,
  ...extra,
});

/** A subcommand of `create` that creates one object of `resource`. */
const createCommand = (
  path: string,
  resource: string,
  flagSpecs: readonly FlagSpec[],
  extra: Partial<KubectlCommand> = {},
) =>
  command(
    `create ${path}`,
    flags(CREATE_SUBCOMMAND, flagSpecs),
    { kind: "name", resource },
    { verb: "create", ...extra },
  );

const setCommand = (
  path: string,
  flagSpecs: readonly FlagSpec[],
  operands: KubectlOperands,
  extra: Partial<KubectlCommand> = {},
) =>
  command(`set ${path}`, flags(OUTPUT, FILES, DRY_RUN, FIELD_MANAGER, "--all", "--local", flagSpecs), operands, {
    verb: "set",
    ...extra,
  });

const rolloutCommand = (path: string, flagSpecs: readonly FlagSpec[]) =>
  command(`rollout ${path}`, flags(FILES, SELECTOR, flagSpecs), TARGETS);

const LABEL_FLAGS = flags(
  OUTPUT,
  FILES,
  SELECTOR,
  FIELD_SELECTOR,
  ALL_NAMESPACES,
  DRY_RUN,
  FIELD_MANAGER,
  "--all",
  "--list",
  "--local",
  "--overwrite",
  "--resource-version=",
);

export const KUBECTL_COMMANDS: readonly KubectlCommand[] = [
  command(
    "get",
    flags(
      OUTPUT,
      FILES,
      SELECTOR,
      FIELD_SELECTOR,
      ALL_NAMESPACES,
      WATCH,
      flag("--watch-only", NEVER_ENDS),
      "--output-watch-events",
      "--chunk-size=",
      "--ignore-not-found",
      "-L|--label-columns=",
      "--no-headers",
      "--server-print",
      "--show-kind",
      "--show-labels",
      "--sort-by=",
      "--subresource=",
    ),
    TARGETS,
  ),
  command("describe", flags(FILES, SELECTOR, ALL_NAMESPACES, "--chunk-size=", "--show-events"), TARGETS),
  command("explain", flags("--api-version=", "-o|--output=", "-R|--recursive"), { kind: "free", max: 1 }),
  command("events", flags(OUTPUT, ALL_NAMESPACES, WATCH, "--chunk-size=", "--for=", "--no-headers", "--types="), {
    kind: "names",
    resource: "events",
    max: 0,
  }),
  command(
    "logs",
    flags(
      SELECTOR,
      "--all-containers",
      "--all-pods",
      "-c|--container=",
      flag("-f|--follow", NEVER_ENDS),
      "--ignore-errors",
      "--insecure-skip-tls-verify-backend",
      "--limit-bytes=",
      "--max-log-requests=",
      "--pod-running-timeout=",
      "--prefix",
      "-p|--previous",
      "--since=",
      "--since-time=",
      "--tail=",
      "--timestamps",
    ),
    { kind: "workload", resource: "pods", extra: 1 },
  ),
  command(
    "top pod",
    flags(
      ALL_NAMESPACES,
      SELECTOR,
      FIELD_SELECTOR,
      "--containers",
      "--no-headers",
      "--show-swap",
      "--sort-by=",
      "--sum",
      "--use-protocol-buffers",
    ),
    { kind: "names", resource: "pods" },
    { verb: "top" },
  ),
  command(
    "top node",
    flags(SELECTOR, "--no-headers", "--show-capacity", "--show-swap", "--sort-by=", "--use-protocol-buffers"),
    { kind: "names", resource: "nodes" },
    { verb: "top" },
  ),
  command(
    "api-resources",
    flags(
      "--api-group=",
      "--cached",
      "--categories=",
      "--namespaced",
      "--no-headers",
      "-o|--output=",
      "--show-managed-fields",
      "--sort-by=",
      "--verbs=",
    ),
    NONE,
  ),
  command("api-versions", [], NONE),
  command("version", flags("--client", "-o|--output="), NONE),
  command("cluster-info", [], NONE),
  command(
    "cluster-info dump",
    flags(OUTPUT, ALL_NAMESPACES, "--namespaces=", flag("--output-directory=", DISK), "--pod-running-timeout="),
    NONE,
  ),
  command("auth can-i", flags(ALL_NAMESPACES, "--list", "--no-headers", "-q|--quiet", "--subresource="), {
    kind: "free",
    max: 2,
  }),
  command("auth whoami", OUTPUT, NONE),
  command(
    "diff",
    flags(
      FILES,
      SELECTOR,
      FIELD_MANAGER,
      "--concurrency=",
      "--force-conflicts",
      "--server-side",
      "--show-managed-fields",
      "--show-secrets",
    ),
    NONE,
    { takesManifest: true },
  ),
  command(
    "apply",
    flags(
      OUTPUT,
      FILES,
      SELECTOR,
      DRY_RUN,
      FIELD_MANAGER,
      VALIDATE,
      "--cascade",
      "--force",
      "--force-conflicts",
      "--grace-period=",
      "--openapi-patch",
      "--overwrite",
      "--server-side",
      "--subresource=",
      "--timeout=",
      "--wait",
    ),
    NONE,
    { takesManifest: true },
  ),
  command(
    "create",
    flags(
      OUTPUT,
      FILES,
      SELECTOR,
      DRY_RUN,
      FIELD_MANAGER,
      VALIDATE,
      flag("--edit", NEVER_ENDS),
      "--save-config",
      "--windows-line-endings",
    ),
    NONE,
    { takesManifest: true },
  ),
  createCommand(
    "clusterrole",
    "clusterroles",
    flags("--aggregation-rule=", "--non-resource-url=", "--resource=", "--resource-name=", "--verb="),
  ),
  createCommand(
    "clusterrolebinding",
    "clusterrolebindings",
    flags("--clusterrole=", "--group=", "--serviceaccount=", "--user="),
  ),
  createCommand(
    "configmap",
    "configmaps",
    flags("--append-hash", flag("--from-env-file=", DISK), flag("--from-file=", DISK), "--from-literal="),
  ),
  createCommand("cronjob", "cronjobs", flags("--image=", "--restart=", "--schedule="), { takesCommand: true }),
  createCommand("deployment", "deployments", flags("--image=", "--port=", "-r|--replicas="), { takesCommand: true }),
  createCommand("ingress", "ingresses", flags("--annotation=", "--class=", "--default-backend=", "--rule=")),
  createCommand("job", "jobs", flags("--from=", "--image="), { takesCommand: true }),
  createCommand("namespace", "namespaces", []),
  createCommand(
    "poddisruptionbudget",
    "poddisruptionbudgets",
    flags("--max-unavailable=", "--min-available=", "--selector="),
  ),
  createCommand(
    "priorityclass",
    "priorityclasses",
    flags("--description=", "--global-default", "--preemption-policy=", "--value="),
  ),
  createCommand("quota", "resourcequotas", flags("--hard=", "--scopes=")),
  createCommand("role", "roles", flags("--resource=", "--resource-name=", "--verb=")),
  createCommand(
    "rolebinding",
    "rolebindings",
    flags("--clusterrole=", "--group=", "--role=", "--serviceaccount=", "--user="),
  ),
  createCommand(
    "secret generic",
    "secrets",
    flags("--append-hash", flag("--from-env-file=", DISK), flag("--from-file=", DISK), "--from-literal=", "--type="),
  ),
  createCommand(
    "secret docker-registry",
    "secrets",
    flags(
      "--append-hash",
      "--docker-email=",
      "--docker-password=",
      "--docker-server=",
      "--docker-username=",
      flag("--from-file=", DISK),
    ),
  ),
  createCommand("secret tls", "secrets", flags("--append-hash", flag("--cert=", DISK), flag("--key=", DISK))),
  createCommand("service clusterip", "services", flags("--clusterip=", "--tcp=")),
  createCommand("service externalname", "services", flags("--external-name=", "--tcp=")),
  createCommand("service loadbalancer", "services", flags("--tcp=")),
  createCommand("service nodeport", "services", flags("--node-port=", "--tcp=")),
  createCommand("serviceaccount", "serviceaccounts", []),
  command(
    "replace",
    flags(
      OUTPUT,
      FILES,
      DRY_RUN,
      FIELD_MANAGER,
      VALIDATE,
      "--cascade",
      "--force",
      "--grace-period=",
      "--save-config",
      "--subresource=",
      "--timeout=",
      "--wait",
    ),
    NONE,
    { takesManifest: true },
  ),
  command(
    "delete",
    flags(
      FILES,
      SELECTOR,
      FIELD_SELECTOR,
      ALL_NAMESPACES,
      DRY_RUN,
      "--all",
      "--cascade",
      "--force",
      "--grace-period=",
      "--ignore-not-found",
      flag("-i|--interactive", NEVER_ENDS),
      "--now",
      "-o|--output=",
      "--timeout=",
      "--wait",
    ),
    TARGETS,
    { takesManifest: true },
  ),
  command(
    "patch",
    flags(
      OUTPUT,
      FILES,
      DRY_RUN,
      FIELD_MANAGER,
      "--local",
      "-p|--patch=",
      flag("--patch-file=", DISK),
      "--subresource=",
      "--type=",
    ),
    TARGETS,
  ),
  command(
    "scale",
    flags(
      OUTPUT,
      FILES,
      SELECTOR,
      DRY_RUN,
      "--all",
      "--current-replicas=",
      "--replicas=",
      "--resource-version=",
      "--timeout=",
    ),
    TARGETS,
  ),
  command(
    "autoscale",
    flags(OUTPUT, FILES, DRY_RUN, FIELD_MANAGER, "--cpu=", "--max=", "--memory=", "--min=", "--name=", "--save-config"),
    TARGETS,
    { selectors: [] },
  ),
  command(
    "expose",
    flags(
      OUTPUT,
      FILES,
      DRY_RUN,
      FIELD_MANAGER,
      "--cluster-ip=",
      "--external-ip=",
      "-l|--labels=",
      "--load-balancer-ip=",
      "--name=",
      "--override-type=",
      "--overrides=",
      "--port=",
      "--protocol=",
      "--save-config",
      "--selector=",
      "--session-affinity=",
      "--target-port=",
      "--type=",
    ),
    TARGETS,
    { selectors: [] },
  ),
  command("label", LABEL_FLAGS, { kind: "targets", pairs: isKeyChange }),
  command("annotate", LABEL_FLAGS, { kind: "targets", pairs: isKeyChange }),
  setCommand(
    "env",
    flags(SELECTOR, "-c|--containers=", "-e|--env=", "--from=", "--keys=", "--list", "--overwrite", "--prefix="),
    { kind: "targets", pairs: isKeyChange },
  ),
  setCommand("image", SELECTOR, { kind: "targets", pairs: isKeyChange }),
  setCommand("resources", flags(SELECTOR, "-c|--containers=", "--limits=", "--requests="), TARGETS),
  setCommand("selector", flags("--resource-version="), { kind: "targets", trailing: 1 }, { selectors: ["--all"] }),
  setCommand("serviceaccount", [], { kind: "targets", trailing: 1 }, { selectors: ["--all"] }),
  setCommand("subject", flags(SELECTOR, "--group=", "--serviceaccount=", "--user="), TARGETS),
  rolloutCommand("history", flags(OUTPUT, "--revision=")),
  rolloutCommand("pause", flags(OUTPUT, FIELD_MANAGER)),
  rolloutCommand("restart", flags(OUTPUT, FIELD_MANAGER)),
  rolloutCommand("resume", flags(OUTPUT, FIELD_MANAGER)),
  rolloutCommand("status", flags(WATCH, "--revision=", "--timeout=")),
  rolloutCommand("undo", flags(OUTPUT, DRY_RUN, "--to-revision=")),
  command("cordon", flags(SELECTOR, DRY_RUN), { kind: "names", resource: "nodes" }),
  command("uncordon", flags(SELECTOR, DRY_RUN), { kind: "names", resource: "nodes" }),
  command(
    "drain",
    flags(
      SELECTOR,
      DRY_RUN,
      "--chunk-size=",
      "--delete-emptydir-data",
      "--disable-eviction",
      "--force",
      "--grace-period=",
      "--ignore-daemonsets",
      "--pod-selector=",
      "--skip-wait-for-delete-timeout=",
      "--timeout=",
    ),
    { kind: "names", resource: "nodes" },
  ),
  command("taint", flags(OUTPUT, SELECTOR, DRY_RUN, FIELD_MANAGER, VALIDATE, "--all", "--overwrite"), {
    kind: "targets",
    pairs: isTaint,
  }),
  command(
    "exec",
    flags(STDIN_AND_TTY, flag("-f|--filename=", DISK), "-c|--container=", "--pod-running-timeout=", "-q|--quiet"),
    { kind: "workload", resource: "pods", extra: 0 },
    { takesCommand: true },
  ),
  command(
    "run",
    flags(
      OUTPUT,
      FILES,
      DRY_RUN,
      FIELD_MANAGER,
      STDIN_AND_TTY,
      "--annotations=",
      "--attach",
      "--cascade",
      "--command",
      "--detach-keys=",
      "--env=",
      "--expose",
      "--force",
      "--grace-period=",
      "--image=",
      "--image-pull-policy=",
      "-l|--labels=",
      "--leave-stdin-open",
      "--override-type=",
      "--overrides=",
      "--pod-running-timeout=",
      "--port=",
      "--privileged",
      "-q|--quiet",
      "--restart=",
      "--rm",
      "--save-config",
      "--timeout=",
      "--wait",
    ),
    { kind: "name", resource: "pods" },
    { takesCommand: true },
  ),
  command(
    "wait",
    flags(OUTPUT, FILES, SELECTOR, FIELD_SELECTOR, ALL_NAMESPACES, "--all", "--for=", "--local", "--timeout="),
    TARGETS,
  ),
];

/** Commands the floor rejects whatever their arguments are. */
export const KUBECTL_FLOOR_COMMANDS: readonly KubectlFloorCommand[] = [
  { path: ["config"], floor: CREDENTIALS },
  { path: ["kuberc"], floor: CREDENTIALS },
  { path: ["certificate"], floor: CREDENTIALS },
  { path: ["create", "token"], floor: CREDENTIALS },
  { path: ["cp"], floor: DISK },
  { path: ["kustomize"], floor: DISK },
  { path: ["plugin"], floor: DISK },
  { path: ["proxy"], floor: NEVER_ENDS },
  { path: ["port-forward"], floor: NEVER_ENDS },
  { path: ["attach"], floor: NEVER_ENDS },
  { path: ["edit"], floor: NEVER_ENDS },
];

/** Verbs of kubectl that the parser does not take, so that kubectl does not look for a plugin of that name. */
export const KUBECTL_UNSUPPORTED_VERBS: readonly string[] = ["alpha", "completion", "debug", "help", "options"];

/** The aliases of command words, by the path of the command they belong to. */
export const KUBECTL_COMMAND_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  create: {
    cm: "configmap",
    cj: "cronjob",
    deploy: "deployment",
    ing: "ingress",
    ns: "namespace",
    pdb: "poddisruptionbudget",
    pc: "priorityclass",
    resourcequota: "quota",
    sa: "serviceaccount",
    svc: "service",
  },
  set: { sa: "serviceaccount" },
  top: { pods: "pod", po: "pod", nodes: "node", no: "node" },
};

/** The flags that select every object of the target resources, unless a command says otherwise. */
export const DEFAULT_SELECTORS: readonly string[] = ["--selector", "--field-selector", "--all"];
