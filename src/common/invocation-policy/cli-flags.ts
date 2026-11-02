// The flags of a CLI as its `--help` documents them, for the parser of the
// invocation policy. kubectl and helm both read their flags with the same
// library, so one description fits both.

import type { FloorEntryId } from "./floor";

export interface FlagSpec {
  /** `--output`. */
  long: string;
  /** `-o`. */
  short?: string;
  /**
   * Whether the flag takes the next argument as its value. Boolean flags, and
   * flags whose value is optional (`--dry-run`, `--cascade`, `--validate`),
   * take a value only after `=`.
   */
  takesValue: boolean;
  /** The floor entry that rejects the flag when it is set; a boolean flag set to `false` is not. */
  floor?: FloorEntryId;
  /** Whether the floor rejects this value; every value when absent. */
  floorRejects?: (value: string) => boolean;
}

/**
 * `"-o|--output="`: the short and the long spelling, and a trailing `=` when
 * the flag takes the next argument as its value.
 */
export const flag = (spelling: string, floor?: FloorEntryId, floorRejects?: (value: string) => boolean): FlagSpec => {
  const takesValue = spelling.endsWith("=");
  const names = (takesValue ? spelling.slice(0, -1) : spelling).split("|");
  const long = names.find((name) => name.startsWith("--")) ?? "";
  const short = names.find((name) => !name.startsWith("--"));
  return {
    long,
    ...(short ? { short } : {}),
    takesValue,
    ...(floor ? { floor } : {}),
    ...(floorRejects ? { floorRejects } : {}),
  };
};

/** A table of flags from spellings, specs and other tables. */
export const flags = (...specs: readonly (string | FlagSpec | readonly FlagSpec[])[]): FlagSpec[] =>
  specs.flatMap((spec) => (typeof spec === "string" ? [flag(spec)] : Array.isArray(spec) ? spec : [spec as FlagSpec]));
