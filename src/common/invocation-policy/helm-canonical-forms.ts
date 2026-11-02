// The canonical forms of a helm CLI invocation: the resource `releases`, with
// the release as the name, and `charts` for `show` and `search repo`, with the
// chart as the name. A chart is named only as `<repository>/<chart>`, a chart
// of a repository the user added: anything else is a local chart path or a
// chart URL, which the floor rejects.

import { type CliCommandTable, isFlagOn, type ParsedInvocation, parseCliInvocation } from "./cli-invocation";
import { type FloorRejection, rejectByFloor } from "./floor";
import {
  HELM_COMMAND_ALIASES,
  HELM_COMMANDS,
  HELM_FLOOR_COMMANDS,
  HELM_FLOOR_ONLY_FLAGS,
  HELM_GLOBAL_FLAGS,
  HELM_UNSUPPORTED_VERBS,
  type HelmCommand,
} from "./helm-commands";

import type { CanonicalForm } from "./canonical-form";

export type HelmInvocation = ParsedInvocation<HelmCommand>;

const HELM_COMMAND_TABLE: CliCommandTable<HelmCommand> = {
  program: "helm",
  globalFlags: HELM_GLOBAL_FLAGS,
  floorOnlyFlags: HELM_FLOOR_ONLY_FLAGS,
  commands: HELM_COMMANDS,
  floorCommands: HELM_FLOOR_COMMANDS,
  unsupportedVerbs: HELM_UNSUPPORTED_VERBS,
  aliases: HELM_COMMAND_ALIASES,
};

/** Parses the arguments of helm into its command, flags and operands, or rejects them by the floor. */
export const parseHelmInvocation = (args: readonly string[]): HelmInvocation | FloorRejection =>
  parseCliInvocation(HELM_COMMAND_TABLE, args);

/** `<repository>/<chart>`, without a version or an archive suffix. */
const REPOSITORY_CHART = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CHART_ARCHIVE = /\.(tgz|tar\.gz)$/;

const isRepositoryChart = (chart: string): boolean => REPOSITORY_CHART.test(chart) && !CHART_ARCHIVE.test(chart);

const commandLine = (invocation: HelmInvocation): string => ["helm", ...invocation.command.path].join(" ");

const unplaceable = (invocation: HelmInvocation, detail: string): FloorRejection =>
  rejectByFloor("unparseable", `${commandLine(invocation)} ${detail}`);

const checkChart = (chart: string): FloorRejection | undefined =>
  isRepositoryChart(chart)
    ? undefined
    : rejectByFloor(
        "local-disk-or-code",
        `${chart} is a local chart path or a chart URL; name a chart of a repository as <repository>/<chart>`,
      );

/** The resource and the names an invocation targets, `*` for whatever a command lists. */
const targetsOf = (
  invocation: HelmInvocation,
): { resource: "releases" | "charts"; names: string[] } | FloorRejection => {
  const { command, operands } = invocation;
  const spec = command.operands;
  const extra = (max: number): FloorRejection | undefined =>
    operands.length > max ? unplaceable(invocation, `does not take the argument ${operands[max]}`) : undefined;

  switch (spec.kind) {
    case "all":
      return extra(spec.max) ?? { resource: spec.resource, names: ["*"] };
    case "release": {
      const [release, ...revisions] = operands;
      if (release === undefined) return unplaceable(invocation, "needs the name of a release");
      const rejection = extra(1 + (spec.revision ?? 0));
      if (rejection) return rejection;
      const revision = revisions.find((value) => !/^\d+$/.test(value));
      if (revision !== undefined) return unplaceable(invocation, `takes a revision number, not ${revision}`);
      return { resource: "releases", names: [release] };
    }
    case "releases":
      return operands.length === 0
        ? unplaceable(invocation, "needs the name of a release")
        : { resource: "releases", names: [...new Set(operands)] };
    case "chart": {
      const [chart] = operands;
      if (chart === undefined) return unplaceable(invocation, "needs a chart");
      return extra(1) ?? checkChart(chart) ?? { resource: "charts", names: [chart] };
    }
    case "release and chart": {
      const [release, chart] = operands;
      if (release === undefined || chart === undefined) {
        return unplaceable(invocation, "needs the name of a release and its chart");
      }
      return extra(2) ?? checkChart(chart) ?? { resource: "releases", names: [release] };
    }
  }
};

/** The canonical forms of a helm invocation, one per target, or the floor rejection of a target it cannot place. */
export function helmCanonicalForms(
  invocation: HelmInvocation,
  defaultNamespace: string,
): CanonicalForm[] | FloorRejection {
  const { command } = invocation;
  if (invocation.commandArgs !== undefined) return unplaceable(invocation, "takes no command after --");
  const targets = targetsOf(invocation);
  if ("kind" in targets) return targets;
  const missing = command.requiredFlags?.find((required) => !isFlagOn(invocation, required.long));
  if (missing) return unplaceable(invocation, `needs ${missing.long}, ${missing.reason}`);

  const namespaceFlag = invocation.flags.get("--namespace");
  const namespace = isFlagOn(invocation, "--all-namespaces")
    ? "*"
    : namespaceFlag === undefined || namespaceFlag === ""
      ? defaultNamespace
      : namespaceFlag;
  return targets.names.map(
    (name): CanonicalForm => ({
      program: "helm",
      verb: command.verb,
      resource: targets.resource,
      name,
      ...(targets.resource === "releases" ? { namespace } : {}),
    }),
  );
}
