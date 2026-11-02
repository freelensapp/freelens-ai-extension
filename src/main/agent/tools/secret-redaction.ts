// Keeps the values of Secrets from the model. A get of Secrets without
// revealSecrets runs with `-o json`, and its output is printed back, as YAML or
// JSON, with every value replaced by its size.

import { Buffer } from "node:buffer";
import { stringify as stringifyYaml } from "yaml";
import { parseKubectlInvocation } from "../../../common/invocation-policy/kubectl-invocation";

import type { PolicyTarget } from "../../../common/invocation-policy/invocation-policy";

/** How a get of Secrets runs and prints without their values. */
export interface SecretRedaction {
  /** The agent's arguments with its output format replaced by `-o json`. */
  args: string[];
  /** How the redacted objects are printed: as YAML when the agent asked for YAML, as JSON otherwise. */
  print: "yaml" | "json";
}

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
 * targets: a get whose targets include `secrets` and whose output is not a
 * table. With revealSecrets the policy names such a target `reveal`,
 * which needs none.
 */
export function planSecretRedaction(
  args: readonly string[],
  targets: readonly PolicyTarget[],
): SecretRedaction | undefined {
  if (!targets.some(({ form }) => form.verb === "get" && form.resource === "secrets")) return undefined;
  const invocation = parseKubectlInvocation(args);
  // The policy parsed these arguments before; should it not now, the output is redacted all the same.
  if ("kind" in invocation) return { args: [...args, "-o", "json"], print: "json" };
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

/**
 * The standard output of a redacted get, printed as the agent asked. An
 * output that is not JSON is withheld, since its values could not be found.
 */
export function redactSecretOutput(stdout: string, print: SecretRedaction["print"]): string {
  if (stdout.trim() === "") return stdout;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return "(withheld: the output was not JSON, so the values of its Secrets could not be redacted)\n";
  }
  const redacted = redactObject(parsed);
  return print === "yaml" ? stringifyYaml(redacted) : `${JSON.stringify(redacted, null, 4)}\n`;
}
