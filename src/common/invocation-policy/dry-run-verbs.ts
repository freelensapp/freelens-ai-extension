import type { CliProgram } from "./canonical-form";

/** A verb whose invocations accept `--dry-run=server`. */
export interface DryRunVerb {
  /** The verb of the canonical forms: `set` covers every `set` subcommand, `create` every `create` subcommand. */
  verb: string;
  /**
   * The output format its dry run is read with: `yaml`, the objects the
   * cluster would make; `name`, the objects `delete` would delete, since it
   * takes no other; `json`, the release a helm `upgrade` would make; `none`
   * for `cordon`, `uncordon` and `drain`, which take no `-o`, and a helm
   * `rollback`, which prints no release.
   */
  output: "yaml" | "json" | "name" | "none";
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
    { verb: "apply", output: "yaml" },
    { verb: "create", output: "yaml" },
    { verb: "replace", output: "yaml" },
    { verb: "patch", output: "yaml" },
    { verb: "delete", output: "name" },
    { verb: "scale", output: "yaml" },
    { verb: "label", output: "yaml" },
    { verb: "annotate", output: "yaml" },
    { verb: "set", output: "yaml" },
    { verb: "rollout undo", output: "yaml" },
    { verb: "cordon", output: "none" },
    { verb: "uncordon", output: "none" },
    { verb: "drain", output: "none" },
    { verb: "taint", output: "yaml" },
  ],
  helm: [
    { verb: "upgrade", output: "json" },
    { verb: "rollback", output: "none" },
  ],
};
