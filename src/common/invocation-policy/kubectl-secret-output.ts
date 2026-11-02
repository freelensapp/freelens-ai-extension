import { type FloorRejection, rejectByFloor } from "./floor";
import { isFlagOn, type KubectlInvocation } from "./kubectl-invocation";

import type { CanonicalForm } from "./canonical-form";

/** The output formats of a get that print values the redaction of a Secret cannot reach. */
const VALUE_PRINTING_FORMATS: ReadonlySet<string> = new Set([
  "jsonpath",
  "jsonpath-as-json",
  "go-template",
  "template",
  "custom-columns",
]);

/** The format of `-o`, without its argument: `jsonpath` of `jsonpath={.data}`. */
const outputFormat = (invocation: KubectlInvocation): string | undefined =>
  invocation.flags.get("--output")?.split("=", 1)[0];

const hasTemplate = (invocation: KubectlInvocation): boolean => (invocation.flags.get("--template") ?? "") !== "";

/** Whether a verb other than get prints the objects it changes, Secret values included. */
const printsObjects = (invocation: KubectlInvocation): boolean => {
  const format = outputFormat(invocation);
  return (
    (format !== undefined && format !== "" && format !== "name") ||
    hasTemplate(invocation) ||
    isFlagOn(invocation, "--show-secrets")
  );
};

const isSecret = (form: CanonicalForm): boolean => form.resource === "secrets";

/**
 * Checks the output of an invocation that targets Secrets. Without
 * `revealSecrets`, a get takes no value-printing format, and any other verb
 * prints at most the names. With it, any other verb that prints the objects
 * gets a `reveal` form for each Secret next to its own.
 */
export function checkSecretOutput(
  invocation: KubectlInvocation,
  forms: readonly CanonicalForm[],
  revealSecrets: boolean,
): CanonicalForm[] | FloorRejection {
  if (!forms.some(isSecret)) return [...forms];
  const isGet = invocation.command.verb === "get";

  if (!revealSecrets) {
    const format = outputFormat(invocation);
    if (isGet && ((format !== undefined && VALUE_PRINTING_FORMATS.has(format)) || hasTemplate(invocation))) {
      return rejectByFloor(
        "secret-output",
        `a get of Secrets cannot use -o ${format ?? "go-template"} without revealSecrets; use -o yaml or -o json, whose values are redacted`,
      );
    }
    if (!isGet && printsObjects(invocation)) {
      return rejectByFloor(
        "secret-output",
        `kubectl ${invocation.command.path.join(" ")} on Secrets prints at most their names without revealSecrets; use -o name or no -o`,
      );
    }
    return [...forms];
  }

  if (isGet || !printsObjects(invocation)) return [...forms];
  return forms.flatMap((form) => (isSecret(form) ? [form, { ...form, verb: "reveal" }] : [form]));
}
