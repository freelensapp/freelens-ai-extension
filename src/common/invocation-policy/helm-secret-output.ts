// The output of helm calls that carry the rendered manifest of a release,
// whose Secret documents hold their values: `get manifest`, `status` (with
// `--debug`, and every `-o json` or `-o yaml`), and `upgrade` and `rollback`
// (with `--dry-run` or `--debug`). Main redacts the Secret documents of their
// table output; `status -o json|yaml`, which prints the release as one object,
// is rejected without `revealSecrets`. Helm values (`get values`) are not
// redacted.

import { type FloorRejection, rejectByFloor } from "./floor";

import type { CanonicalForm } from "./canonical-form";
import type { HelmInvocation } from "./helm-canonical-forms";

/** The reads whose output can carry the release's manifest; with `revealSecrets` their verb is `reveal`. */
const MANIFEST_READ_VERBS: ReadonlySet<string> = new Set(["get manifest", "status"]);

/** The changes whose output can carry the release's manifest; with `revealSecrets` they get a `reveal` form too. */
const MANIFEST_CHANGE_VERBS: ReadonlySet<string> = new Set(["upgrade", "rollback"]);

/** Whether the output of a helm verb can carry the rendered manifest of a release, Secret values included. */
export const printsReleaseManifest = (verb: string): boolean =>
  MANIFEST_READ_VERBS.has(verb) || MANIFEST_CHANGE_VERBS.has(verb);

/** The output formats that print the release as one object, its manifest a string the redaction does not reach. */
const RELEASE_OBJECT_FORMATS: ReadonlySet<string> = new Set(["json", "yaml"]);

/**
 * Checks the output of a helm invocation that can print a release's
 * manifest. Without `revealSecrets`, a format that prints the release as one
 * object is rejected. With it, a read's forms have the verb `reveal`, and a
 * change gets a `reveal` form next to its own.
 */
export function checkHelmSecretOutput(
  invocation: HelmInvocation,
  forms: readonly CanonicalForm[],
  revealSecrets: boolean,
): CanonicalForm[] | FloorRejection {
  const { verb } = invocation.command;
  if (!revealSecrets) {
    const format = invocation.flags.get("--output") ?? "";
    if (printsReleaseManifest(verb) && RELEASE_OBJECT_FORMATS.has(format)) {
      return rejectByFloor(
        "secret-output",
        `helm ${invocation.command.path.join(" ")} -o ${format} prints the manifest of the release, Secret values included, without revealSecrets; use -o table, or helm get manifest, whose Secret values are redacted`,
      );
    }
    return [...forms];
  }
  if (MANIFEST_READ_VERBS.has(verb)) return forms.map((form) => ({ ...form, verb: "reveal" }));
  if (MANIFEST_CHANGE_VERBS.has(verb)) return forms.flatMap((form) => [form, { ...form, verb: "reveal" }]);
  return [...forms];
}
