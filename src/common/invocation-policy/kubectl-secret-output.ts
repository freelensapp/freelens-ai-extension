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
 * The verbs that read Secrets with their values: `get`, whose output the
 * redaction covers, and `describe`, which prints the values of some types,
 * the token of a service-account token Secret among them. With
 * `revealSecrets`, their forms on Secrets have the verb `reveal`.
 */
export const SECRET_READ_VERBS: ReadonlySet<string> = new Set(["get", "describe"]);

/**
 * Checks the output of an invocation that targets Secrets. Without
 * `revealSecrets`, a get takes no value-printing format, a describe is
 * rejected, since no redaction reaches its output, and any other verb prints
 * at most the names. With it, a verb other than get and describe that prints
 * the objects gets a `reveal` form for each Secret next to its own.
 */
export function checkSecretOutput(
  invocation: KubectlInvocation,
  forms: readonly CanonicalForm[],
  revealSecrets: boolean,
): CanonicalForm[] | FloorRejection {
  if (!forms.some(isSecret)) return [...forms];
  const isGet = invocation.command.verb === "get";
  const isRead = SECRET_READ_VERBS.has(invocation.command.verb);

  if (!revealSecrets) {
    if (invocation.command.verb === "describe") {
      return rejectByFloor(
        "secret-output",
        "kubectl describe prints the values of Secrets such as service-account tokens without revealSecrets; use get secrets, whose values are redacted, or set revealSecrets",
      );
    }
    const format = outputFormat(invocation);
    if (isGet && ((format !== undefined && VALUE_PRINTING_FORMATS.has(format)) || hasTemplate(invocation))) {
      return rejectByFloor(
        "secret-output",
        `a get of Secrets cannot use -o ${format ?? "go-template"} without revealSecrets; use -o yaml or -o json, whose values are redacted`,
      );
    }
    if (!isRead && printsObjects(invocation)) {
      return rejectByFloor(
        "secret-output",
        `kubectl ${invocation.command.path.join(" ")} on Secrets prints at most their names without revealSecrets; use -o name or no -o`,
      );
    }
    return [...forms];
  }

  if (isRead || !printsObjects(invocation)) return [...forms];
  return forms.flatMap((form) => (isSecret(form) ? [form, { ...form, verb: "reveal" }] : [form]));
}
