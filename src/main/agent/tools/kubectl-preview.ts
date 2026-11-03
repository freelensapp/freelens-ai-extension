// The dry-run preview of a kubectl call that waits for approval: the gate runs
// the same invocation with `--dry-run=server` and reads the current object of
// each named target, both through the runner of the tool, and the card shows
// what the cluster would become. The preview goes to the card only, never to
// the model: the dry run and the current objects can hold Secret values.

import { parseAllDocuments, stringify as stringifyYaml } from "yaml";
import { formatCanonicalForm } from "../../../common/invocation-policy/canonical-form";
import { splitAtCommand } from "../../../common/invocation-policy/cli-invocation";
import { apiGroupOf } from "../../../common/invocation-policy/resource-catalog";
import { unifiedDiff } from "./line-diff";
import {
  dryRunRejection,
  type PreviewOutcome,
  previewFailure,
  previewUnavailable,
  runPreviewInvocation,
  wasStopped,
} from "./preview-invocation";

import type { CliTargetDiff } from "../../../common/agent-protocol";
import type { CanonicalForm } from "../../../common/invocation-policy/canonical-form";
import type { DryRunVerb } from "../../../common/invocation-policy/dry-run-verbs";
import type { ResourceCatalog } from "../../../common/invocation-policy/resource-catalog";
import type { ClusterReadContext } from "./cluster-resources";

/** A call made ready to run, as the dry run repeats it. */
export interface KubectlPreviewCall {
  /** The arguments that will run, `-f -` included. */
  args: readonly string[];
  manifest?: string;
  verb: DryRunVerb;
  /** The canonical forms of the call. */
  targets: readonly CanonicalForm[];
  catalog: ResourceCatalog;
}

/** The most object names an unavailable preview lists. */
const MAX_LISTED_OBJECTS = 50;

// What the server answers to a change that cannot happen. A webhook without
// dry-run support, an API without `dryRun` and every other error leave the
// preview unavailable instead, and the user is still asked.
const SERVER_REJECTION =
  /Error from server \((Invalid|Forbidden|NotFound|AlreadyExists|Conflict)\)|admission webhook "[^"]*" denied the request/;
const NOT_FOUND = /Error from server \(NotFound\)/;

interface KubeObject {
  apiVersion?: unknown;
  kind?: unknown;
  metadata?: { name?: unknown; namespace?: unknown; managedFields?: unknown };
  items?: unknown;
}

const isObject = (value: unknown): value is KubeObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The dry-run flags, before the arguments after `--`, which belong to a command. The
// values given last win, so they replace the agent's own `--dry-run` or `-o`.
const dryRunArgs = (args: readonly string[], verb: DryRunVerb): string[] => {
  const output = verb.output === "none" ? [] : ["-o", verb.output];
  const { own, command } = splitAtCommand(args);
  return [...own, "--dry-run=server", ...output, ...command];
};

const readArgs = (target: CanonicalForm): string[] => [
  "get",
  target.resource ?? "",
  target.name ?? "",
  ...(target.namespace === undefined ? [] : ["-n", target.namespace]),
  "-o",
  "yaml",
];

const run = (context: ClusterReadContext, args: readonly string[], manifest?: string) =>
  runPreviewInvocation(context, "kubectl", args, manifest);

const withoutManagedFields = (object: KubeObject): KubeObject => {
  if (!isObject(object.metadata) || !("managedFields" in object.metadata)) return object;
  const { managedFields: _managedFields, ...metadata } = object.metadata;
  return { ...object, metadata };
};

const toYaml = (object: KubeObject): string =>
  stringifyYaml(withoutManagedFields(object), { lineWidth: 0, aliasDuplicateObjects: false });

// The objects of `-o yaml` output: the documents, with the items of a List.
const parseObjects = (stdout: string): KubeObject[] | undefined => {
  const documents = parseAllDocuments(stdout);
  if (documents.some((document) => document.errors.length > 0)) return undefined;
  const objects: KubeObject[] = [];
  for (const document of documents) {
    const value: unknown = document.toJS();
    if (value === null || value === undefined) continue;
    if (!isObject(value)) return undefined;
    const items = typeof value.kind === "string" && value.kind.endsWith("List") ? value.items : undefined;
    for (const object of Array.isArray(items) ? items : [value]) {
      if (!isObject(object) || typeof object.metadata?.name !== "string" || typeof object.kind !== "string") {
        return undefined;
      }
      objects.push(object);
    }
  }
  return objects;
};

const groupOf = (apiVersion: unknown): string => (typeof apiVersion === "string" ? apiGroupOf(apiVersion) : "");

// The plural resource of an object, as the canonical forms name it.
const resourceOf = (catalog: ResourceCatalog, kind: string, group: string): string | undefined =>
  catalog.find((resource) => resource.kind.toLowerCase() === kind.toLowerCase() && resource.group === group)?.name;

const objectName = (catalog: ResourceCatalog, object: KubeObject): string =>
  `${resourceOf(catalog, String(object.kind), groupOf(object.apiVersion)) ?? String(object.kind).toLowerCase()}/${String(object.metadata?.name)}`;

// A line of `-o name`, `<kind>[.<group>]/<name>`, with the kind's resource.
const nameLineObject = (catalog: ResourceCatalog, line: string): string => {
  const slash = line.indexOf("/");
  if (slash < 0) return line;
  const type = line.slice(0, slash);
  const dot = type.indexOf(".");
  const kind = dot < 0 ? type : type.slice(0, dot);
  const group = dot < 0 ? "" : type.slice(dot + 1);
  const resource = resourceOf(catalog, kind, group);
  return resource ? `${resource}/${line.slice(slash + 1)}` : line;
};

const matches = (catalog: ResourceCatalog, target: CanonicalForm, object: KubeObject): boolean =>
  object.metadata?.name === target.name &&
  (object.metadata?.namespace ?? undefined) === target.namespace &&
  resourceOf(catalog, String(object.kind), groupOf(object.apiVersion)) === target.resource;

const listObjects = (names: readonly string[]): string => {
  const listed = names.slice(0, MAX_LISTED_OBJECTS).join(", ");
  const more = names.length > MAX_LISTED_OBJECTS ? ` and ${names.length - MAX_LISTED_OBJECTS} more` : "";
  return `the dry run reports ${names.length} ${names.length === 1 ? "object" : "objects"}: ${listed}${more}`;
};

/** A target's current object: its YAML, absent when it does not exist yet, or why it could not be read. */
type CurrentObject = { kind: "found"; yaml: string } | { kind: "absent" } | { kind: "failed"; reason: string };

/**
 * Runs the dry run of a call and reads the current object of each named
 * target, and makes the card's preview of them: a diff per target, or the
 * reason there is none. A dry run the server rejects is the rejection for the
 * model, and nobody is asked.
 */
export async function previewKubectlInvocation(
  context: ClusterReadContext,
  call: KubectlPreviewCall,
): Promise<PreviewOutcome> {
  const { verb, catalog } = call;
  const dryRun = await run(context, dryRunArgs(call.args, verb), call.manifest);
  if (wasStopped(context, dryRun)) return { kind: "stopped" };
  const rejection = dryRunRejection(dryRun, SERVER_REJECTION);
  if (rejection !== undefined) return { kind: "rejected", message: rejection };
  const dryRunFailed = dryRun.exitCode !== 0;

  // The targets named in the call; a selector, `--all` or a missing name targets objects only the cluster knows.
  const forms = call.targets.filter((target) => target.verb !== "reveal");
  const named = forms.filter(
    (target, index) =>
      target.resource !== undefined &&
      target.name !== undefined &&
      target.name !== "*" &&
      target.namespace !== "*" &&
      forms.findIndex((other) => formatCanonicalForm(other) === formatCanonicalForm(target)) === index,
  );
  const unnamed = forms.some(
    (target) => target.resource === undefined || target.name === "*" || target.namespace === "*",
  );

  const current = new Map<CanonicalForm, CurrentObject>();
  for (const target of named) {
    const read = await run(context, readArgs(target));
    if (wasStopped(context, read)) return { kind: "stopped" };
    const [object] = read.exitCode === 0 ? (parseObjects(read.stdout) ?? []) : [];
    current.set(
      target,
      object
        ? { kind: "found", yaml: toYaml(object) }
        : read.exitCode !== 0 && read.killed === undefined && NOT_FOUND.test(read.stderr)
          ? { kind: "absent" }
          : { kind: "failed", reason: previewFailure(`reading ${formatCanonicalForm(target)}`, read) },
    );
  }

  const backups = [...current.values()].flatMap((object) => (object.kind === "found" ? [object.yaml] : []));
  const unavailable = (reason: string) => previewUnavailable(reason, backups.join("---\n"));

  if (dryRunFailed) return unavailable(previewFailure("the dry run", dryRun));
  const failedRead = [...current.values()].find((object) => object.kind === "failed");
  if (failedRead?.kind === "failed") return unavailable(failedRead.reason);

  let reported: KubeObject[] | string[];
  if (verb.output === "yaml") {
    const objects = parseObjects(dryRun.stdout);
    if (!objects) return unavailable("kubectl printed a dry run the preview does not recognize");
    reported = objects;
  } else if (verb.output === "name") {
    reported = dryRun.stdout.split("\n").flatMap((line) => (line.trim() ? [nameLineObject(catalog, line.trim())] : []));
  } else {
    return unavailable(`kubectl ${verb.verb} prints no object in a dry run`);
  }

  if (unnamed) {
    const names = reported.map((object) => (typeof object === "string" ? object : objectName(catalog, object)));
    const reason =
      "the targets are not all named (a selector, --all or no name), so their current objects are not read";
    return unavailable(names.length > 0 ? `${reason}; ${listObjects(names)}` : reason);
  }

  const diffs: CliTargetDiff[] = [];
  for (const target of named) {
    const before = current.get(target);
    const beforeYaml = before?.kind === "found" ? before.yaml : "";
    let afterYaml = "";
    if (verb.output === "yaml") {
      const object = (reported as KubeObject[]).find((candidate) => matches(catalog, target, candidate));
      if (!object) return unavailable("kubectl printed a dry run the preview does not recognize");
      afterYaml = toYaml(object);
    }
    diffs.push({ target, diff: unifiedDiff(beforeYaml, afterYaml, { before: "current", after: "dry run" }) });
  }
  return { kind: "preview", preview: { kind: "diffs", diffs } };
}
