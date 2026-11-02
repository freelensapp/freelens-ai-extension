// Keeps the values of Secrets from the model. A kubectl get of Secrets without
// revealSecrets runs with `-o json`, and its output is printed back, as YAML or
// JSON, with every value replaced by its size. The output of a helm call that
// can carry a release's manifest has the same values of its Secret documents
// replaced.

import { Buffer } from "node:buffer";
import { parseDocument, stringify as stringifyYaml } from "yaml";
import { printsReleaseManifest } from "../../../common/invocation-policy/helm-secret-output";
import { parseKubectlInvocation } from "../../../common/invocation-policy/kubectl-invocation";

import type { CliProgram } from "../../../common/invocation-policy/canonical-form";
import type { PolicyTarget } from "../../../common/invocation-policy/invocation-policy";

/** How a call runs and prints without the values of Secrets. */
export type SecretRedaction =
  /** A kubectl get of Secrets. */
  | {
      kind: "objects";
      /** The agent's arguments with its output format replaced by `-o json`. */
      args: string[];
      /** How the redacted objects are printed: as YAML when the agent asked for YAML, as JSON otherwise. */
      print: "yaml" | "json";
    }
  /** A helm call whose output can carry a release's manifest: it runs as asked, and its Secret documents are redacted. */
  | { kind: "manifest" };

/** What the model reads next to a redacted output. */
export const SECRET_REDACTION_NOTE =
  "Secret values are redacted: each value of data and stringData, and the annotation " +
  "kubectl.kubernetes.io/last-applied-configuration, is replaced by its size. Set revealSecrets to read them.";

/** The output formats that print a table, without values. */
const TABLE_FORMATS: ReadonlySet<string> = new Set(["", "wide", "name"]);

/** The output formats that print YAML. */
const YAML_FORMATS: ReadonlySet<string> = new Set(["yaml", "kyaml"]);

/**
 * The redaction of a call the invocation policy let through, from its
 * targets: a kubectl get whose targets include `secrets` and whose output is
 * not a table, or a helm call whose output can carry a release's manifest.
 * With revealSecrets the policy names such a target `reveal`, which needs
 * none.
 */
export function planSecretRedaction(
  program: CliProgram,
  args: readonly string[],
  targets: readonly PolicyTarget[],
): SecretRedaction | undefined {
  if (program === "helm") {
    const reveals = targets.some(({ form }) => form.verb === "reveal");
    return !reveals && targets.some(({ form }) => printsReleaseManifest(form.verb)) ? { kind: "manifest" } : undefined;
  }
  if (!targets.some(({ form }) => form.verb === "get" && form.resource === "secrets")) return undefined;
  const invocation = parseKubectlInvocation(args);
  // The policy parsed these arguments before; should it not now, the output is redacted all the same.
  if ("kind" in invocation) return { kind: "objects", args: [...args, "-o", "json"], print: "json" };
  const format = invocation.flags.get("--output")?.split("=", 1)[0] ?? "";
  if (TABLE_FORMATS.has(format)) return undefined;
  // A token that sets the output format only is dropped; one that sets other
  // flags too (`-Ao yaml`) stays, and the `-o json` after it wins.
  const dropped = new Set(
    invocation.flagArgs
      .filter((token) => token.longs.length === 1 && token.longs[0] === "--output")
      .flatMap((token) => Array.from({ length: token.count }, (_, offset) => token.index + offset)),
  );
  const end = args.indexOf("--");
  const own = (end < 0 ? args : args.slice(0, end)).filter((_, index) => !dropped.has(index));
  return {
    kind: "objects",
    args: [...own, "-o", "json", ...(end < 0 ? [] : args.slice(end))],
    print: YAML_FORMATS.has(format) ? "yaml" : "json",
  };
}

/** The annotation of client-side apply, a copy of the whole manifest, values included. */
const LAST_APPLIED_ANNOTATION = "kubectl.kubernetes.io/last-applied-configuration";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A value replaced by its size; `decode` gives the bytes of a value.
const redactValue = (value: unknown, decode: (value: string) => Buffer): string => {
  if (typeof value !== "string") return "redacted";
  const bytes = decode(value).length;
  return `redacted, ${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
};

const base64 = (value: string) => Buffer.from(value, "base64");
const utf8 = (value: string) => Buffer.from(value, "utf8");

const redactValues = (values: unknown, decode: (value: string) => Buffer): unknown =>
  isRecord(values)
    ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, redactValue(value, decode)]))
    : values;

// The metadata of a Secret with the last applied configuration replaced by its size.
const redactMetadata = (metadata: unknown): unknown => {
  if (!isRecord(metadata) || !isRecord(metadata.annotations) || !(LAST_APPLIED_ANNOTATION in metadata.annotations)) {
    return metadata;
  }
  const annotations = metadata.annotations;
  return {
    ...metadata,
    annotations: { ...annotations, [LAST_APPLIED_ANNOTATION]: redactValue(annotations[LAST_APPLIED_ANNOTATION], utf8) },
  };
};

// Whether an object is a Secret, or a List that holds one.
const holdsSecret = (object: unknown): boolean =>
  isRecord(object) && (object.kind === "Secret" || (Array.isArray(object.items) && object.items.some(holdsSecret)));

// A Secret without its values; every other object as it is. A List has its items redacted.
const redactObject = (object: unknown): unknown => {
  if (!isRecord(object)) return object;
  if (Array.isArray(object.items)) return { ...object, items: object.items.map(redactObject) };
  if (object.kind !== "Secret") return object;
  return {
    ...object,
    ...("data" in object ? { data: redactValues(object.data, base64) } : {}),
    ...("stringData" in object ? { stringData: redactValues(object.stringData, utf8) } : {}),
    ...("metadata" in object ? { metadata: redactMetadata(object.metadata) } : {}),
  };
};

// The standard output of a redacted get, printed as the agent asked. An
// output that is not JSON is withheld, since its values could not be found.
const redactObjectOutput = (stdout: string, print: "yaml" | "json"): string => {
  if (stdout.trim() === "") return stdout;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return "(withheld: the output was not JSON, so the values of its Secrets could not be redacted)\n";
  }
  const redacted = redactObject(parsed);
  return print === "yaml" ? stringifyYaml(redacted) : `${JSON.stringify(redacted, null, 4)}\n`;
};

/**
 * Where helm's output splits into parts: a YAML document marker, and the
 * headings of its table output (`HOOKS:`, `MANIFEST:`, `NOTES:` and, with
 * `--debug`, the values).
 */
const MANIFEST_BOUNDARY = /^(---\s*(#.*)?|HOOKS:|MANIFEST:|NOTES:|USER-SUPPLIED VALUES:|COMPUTED VALUES:)$/;

/** A part that names the kind Secret, as YAML or JSON. */
const NAMES_SECRET = /["']?kind["']?\s*:\s*["']?Secret\b/;

const WITHHELD_SECRET = "# withheld: a Secret document that could not be parsed, so its values could not be redacted";

const isBlankOrComment = (line: string) => line.trim() === "" || line.trimStart().startsWith("#");

// One part of helm's output between two boundaries, as lines: a Secret with
// its values replaced by their sizes, printed as YAML after its leading
// comments (`# Source: ...`), or withheld when it does not parse; any other
// part as it is.
const redactManifestPart = (lines: readonly string[]): { lines: readonly string[]; redacted: boolean } => {
  let start = 0;
  while (start < lines.length && isBlankOrComment(lines[start] ?? "")) start += 1;
  let end = lines.length;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end -= 1;
  const body = lines.slice(start, end).join("\n");
  if (body === "") return { lines, redacted: false };
  const document = parseDocument(body);
  if (document.errors.length > 0) {
    return NAMES_SECRET.test(body)
      ? { lines: [...lines.slice(0, start), WITHHELD_SECRET, ...lines.slice(end)], redacted: true }
      : { lines, redacted: false };
  }
  const object: unknown = document.toJS();
  if (!holdsSecret(object)) return { lines, redacted: false };
  const yaml = stringifyYaml(redactObject(object), { lineWidth: 0 }).replace(/\n$/, "");
  return { lines: [...lines.slice(0, start), ...yaml.split("\n"), ...lines.slice(end)], redacted: true };
};

// The output of a helm call with the values of each Secret document replaced by their sizes.
const redactManifestOutput = (stdout: string): { stdout: string; redacted: boolean } => {
  const output: string[] = [];
  let part: string[] = [];
  let redacted = false;
  const flush = () => {
    const result = redactManifestPart(part);
    output.push(...result.lines);
    redacted ||= result.redacted;
    part = [];
  };
  for (const line of stdout.split("\n")) {
    if (MANIFEST_BOUNDARY.test(line)) {
      flush();
      output.push(line);
    } else {
      part.push(line);
    }
  }
  flush();
  return { stdout: output.join("\n"), redacted };
};

/**
 * The standard output of a call with its Secret values redacted, and whether
 * the model reads the redaction note with it: always for a kubectl get of
 * Secrets, for helm only when a Secret document was redacted or withheld.
 */
export function redactSecretOutput(stdout: string, redaction: SecretRedaction): { stdout: string; redacted: boolean } {
  if (redaction.kind === "manifest") return redactManifestOutput(stdout);
  return { stdout: redactObjectOutput(stdout, redaction.print), redacted: true };
}
