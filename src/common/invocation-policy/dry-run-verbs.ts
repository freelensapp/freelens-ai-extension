import type { CliProgram } from "./canonical-form";

/** A verb whose invocations accept `--dry-run=server`. */
export interface DryRunVerb {
  /** The verb of the canonical forms: `set` covers every `set` subcommand, `create` every `create` subcommand. */
  verb: string;
  /**
   * Whether its invocations also take `-o yaml`, to print what the cluster
   * would become. `delete` takes only `-o name`; `cordon`, `uncordon` and
   * `drain` take no `-o`.
   */
  acceptsYamlOutput: boolean;
}

/**
 * The verbs whose invocations accept `--dry-run=server`, by program, as
 * `kubectl <verb> --help` of kubectl 1.36 and `helm <verb> --help` of helm 4.3
 * document them. A fact about the CLIs, not a setting. `rollout restart` has
 * no `--dry-run`. helm `upgrade` prints the release it would make, which the
 * preview reads with `-o json`; `rollback` prints no release.
 */
export const DRY_RUN_VERBS: Readonly<Record<CliProgram, readonly DryRunVerb[]>> = {
  kubectl: [
    { verb: "apply", acceptsYamlOutput: true },
    { verb: "create", acceptsYamlOutput: true },
    { verb: "replace", acceptsYamlOutput: true },
    { verb: "patch", acceptsYamlOutput: true },
    { verb: "delete", acceptsYamlOutput: false },
    { verb: "scale", acceptsYamlOutput: true },
    { verb: "label", acceptsYamlOutput: true },
    { verb: "annotate", acceptsYamlOutput: true },
    { verb: "set", acceptsYamlOutput: true },
    { verb: "rollout undo", acceptsYamlOutput: true },
    { verb: "cordon", acceptsYamlOutput: false },
    { verb: "uncordon", acceptsYamlOutput: false },
    { verb: "drain", acceptsYamlOutput: false },
    { verb: "taint", acceptsYamlOutput: true },
  ],
  helm: [
    { verb: "upgrade", acceptsYamlOutput: true },
    { verb: "rollback", acceptsYamlOutput: false },
  ],
};
