// What the kubectl and helm tools share: their parameters and the limits of
// their timeout.

import { Type } from "typebox";

import type { CliProgram } from "../invocation-policy/canonical-form";

/** The timeout of a CLI invocation when the call sets none, in seconds. */
export const DEFAULT_CLI_TIMEOUT_SECONDS = 30;
/** The longest timeout a call can set, in seconds; a longer one is cut to it. */
export const MAX_CLI_TIMEOUT_SECONDS = 300;

/** The parameters of a CLI tool; the kubectl and helm tools take the same. */
export const cliToolParameters = (program: CliProgram) =>
  Type.Object({
    args: Type.Array(Type.String(), {
      description: `The arguments after "${program}", the verb first, each as its own string`,
    }),
    manifest: Type.Optional(
      Type.String({
        description:
          program === "kubectl"
            ? "One or more objects as YAML (separated by ---) or JSON, sent on standard input. Only with apply, " +
              "create, replace, delete or diff"
            : "Not taken by any helm verb: leave it unset",
      }),
    ),
    grep: Type.Optional(
      Type.String({
        description:
          "A JavaScript regular expression: only the lines of the standard output that match it are kept. " +
          "Case-sensitive and unanchored",
      }),
    ),
    timeoutSeconds: Type.Optional(
      Type.Number({
        exclusiveMinimum: 0,
        description:
          program === "kubectl"
            ? `How long kubectl may run before it is killed, in seconds: ${DEFAULT_CLI_TIMEOUT_SECONDS} when unset, at most ${MAX_CLI_TIMEOUT_SECONDS}`
            : `How long helm may run before it is killed, in seconds: ${DEFAULT_CLI_TIMEOUT_SECONDS} when unset (${MAX_CLI_TIMEOUT_SECONDS} for upgrade, rollback and uninstall), at most ${MAX_CLI_TIMEOUT_SECONDS}`,
      }),
    ),
    revealSecrets: Type.Optional(
      Type.Boolean({
        description:
          program === "kubectl"
            ? "Ask for the values of Secrets unredacted"
            : "Ask for the Secrets of a release's manifest unredacted (get manifest, status, upgrade, rollback)",
      }),
    ),
  });
