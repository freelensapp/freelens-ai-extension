// Parses the arguments of a kubectl CLI invocation the way kubectl's command
// line library does: flags anywhere after the verb words, global flags also
// before them, every spelling of a flag (`-n prod`, `-nprod`, `-n=prod`,
// `--namespace prod`, `--namespace=prod`), grouped short flags (`-it`) and
// `--` before a command. What it cannot place is a floor rejection.

import { type FloorRejection, rejectByFloor } from "./floor";
import {
  type FlagSpec,
  KUBECTL_COMMAND_ALIASES,
  KUBECTL_COMMANDS,
  KUBECTL_FLOOR_COMMANDS,
  KUBECTL_FLOOR_ONLY_FLAGS,
  KUBECTL_GLOBAL_FLAGS,
  KUBECTL_UNSUPPORTED_VERBS,
  type KubectlCommand,
} from "./kubectl-commands";

export interface KubectlInvocation {
  command: KubectlCommand;
  /** The value of each flag that is set, by its long spelling; the last one wins, and a boolean flag without a value is `"true"`. */
  flags: ReadonlyMap<string, string>;
  /** The positional arguments past the verb words and before `--`. */
  operands: readonly string[];
  /** The arguments after `--`, the command of `exec` or `run`; absent without `--`. */
  commandArgs?: readonly string[];
}

/** The spellings of `false` that kubectl takes for a boolean flag. */
const FALSE_VALUES: ReadonlySet<string> = new Set(["false", "0", "f", "F", "FALSE", "False"]);

/** Whether a flag is set and, for a boolean flag, not set to false. */
export const isFlagOn = (invocation: KubectlInvocation, long: string): boolean => {
  const value = invocation.flags.get(long);
  return value !== undefined && !FALSE_VALUES.has(value);
};

type FlagSource = "command" | "global" | "floor-only";

interface FoundFlag {
  spec: FlagSpec;
  source: FlagSource;
}

type FlagLookup = (spelling: string) => FoundFlag | undefined;

const lookupIn =
  (...tables: readonly [readonly FlagSpec[], FlagSource][]): FlagLookup =>
  (spelling) => {
    for (const [table, source] of tables) {
      const spec = table.find((candidate) => candidate.long === spelling || candidate.short === spelling);
      if (spec) return { spec, source };
    }
    return undefined;
  };

const lookupGlobal = lookupIn([KUBECTL_GLOBAL_FLAGS, "global"], [KUBECTL_FLOOR_ONLY_FLAGS, "floor-only"]);

const lookupForCommand = (command: KubectlCommand): FlagLookup =>
  lookupIn([command.flags, "command"], [KUBECTL_GLOBAL_FLAGS, "global"], [KUBECTL_FLOOR_ONLY_FLAGS, "floor-only"]);

const commandLine = (path: readonly string[]): string => ["kubectl", ...path].join(" ");

const unsupportedFlag = (spelling: string, path: readonly string[]): FloorRejection =>
  rejectByFloor(
    "unparseable",
    `${spelling} is not a supported flag of ${commandLine(path)}; run it without ${spelling}`,
  );

interface FlagToken {
  /** The flags the token sets, with their values. */
  set: { found: FoundFlag; spelling: string; value: string }[];
  /** How many arguments the token used, its value included. */
  used: number;
}

/** Reads the flag token at `index`: one long flag, or one or more grouped short flags. */
const readFlagToken = (
  args: readonly string[],
  index: number,
  lookup: FlagLookup,
  path: readonly string[],
): FlagToken | FloorRejection => {
  const token = args[index] ?? "";
  const nextValue = (spelling: string): { value: string; used: number } | FloorRejection => {
    const value = args[index + 1];
    return value === undefined
      ? rejectByFloor("unparseable", `${spelling} of ${commandLine(path)} needs a value`)
      : { value, used: 2 };
  };

  if (token.startsWith("--")) {
    const equals = token.indexOf("=");
    const spelling = equals === -1 ? token : token.slice(0, equals);
    const found = lookup(spelling);
    if (!found) return unsupportedFlag(spelling, path);
    if (equals !== -1) return { set: [{ found, spelling, value: token.slice(equals + 1) }], used: 1 };
    if (!found.spec.takesValue) return { set: [{ found, spelling, value: "true" }], used: 1 };
    const next = nextValue(spelling);
    return "kind" in next ? next : { set: [{ found, spelling, value: next.value }], used: next.used };
  }

  const set: FlagToken["set"] = [];
  for (let position = 1; position < token.length; position++) {
    const spelling = `-${token[position]}`;
    const found = lookup(spelling);
    if (!found) return unsupportedFlag(spelling, path);
    const rest = token.slice(position + 1);
    if (found.spec.takesValue) {
      const attached = rest.startsWith("=") ? rest.slice(1) : rest;
      if (attached !== "") return { set: [...set, { found, spelling, value: attached }], used: 1 };
      const next = nextValue(spelling);
      return "kind" in next ? next : { set: [...set, { found, spelling, value: next.value }], used: next.used };
    }
    if (rest.startsWith("=")) return { set: [...set, { found, spelling, value: rest.slice(1) }], used: 1 };
    set.push({ found, spelling, value: "true" });
  }
  return { set, used: 1 };
};

const isFlagToken = (argument: string): boolean => argument.startsWith("-") && argument !== "-";

const samePath = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((word, position) => word === b[position]);

const startsPath = (path: readonly string[], prefix: readonly string[]): boolean =>
  prefix.length <= path.length && prefix.every((word, position) => word === path[position]);

const ALL_PATHS: readonly (readonly string[])[] = [
  ...KUBECTL_COMMANDS.map((command) => command.path),
  ...KUBECTL_FLOOR_COMMANDS.map((command) => command.path),
];

/**
 * The flags each invocation sets, applied in order. A flag of the floor that is
 * set is rejected; a flag that only the floor knows is not supported otherwise.
 */
const applyFlags = (
  token: FlagToken,
  flags: Map<string, string>,
  path: readonly string[],
): FloorRejection | undefined => {
  for (const { found, spelling, value } of token.set) {
    const { spec } = found;
    const rejected = spec.takesValue || !FALSE_VALUES.has(value);
    if (spec.floor && rejected && (spec.floorRejects?.(value) ?? true)) {
      return rejectByFloor(spec.floor, `${spelling} is never allowed`);
    }
    if (found.source === "floor-only") return unsupportedFlag(spelling, path);
    flags.set(spec.long, value);
  }
  return undefined;
};

/** Parses the arguments of kubectl into its command, flags and operands, or rejects them by the floor. */
export function parseKubectlInvocation(args: readonly string[]): KubectlInvocation | FloorRejection {
  const flags = new Map<string, string>();
  const path: string[] = [];
  let index = 0;

  // The verb words, with global flags before and between them. Once the words
  // name a command, a flag ends them: `logs -f` is `--follow`, not `--filename`.
  while (index < args.length) {
    const argument = args[index] ?? "";
    if (isFlagToken(argument) && argument !== "--") {
      if (KUBECTL_COMMANDS.some((command) => samePath(command.path, path))) break;
      const token = readFlagToken(args, index, lookupGlobal, path);
      if ("kind" in token) return token;
      const rejection = applyFlags(token, flags, path);
      if (rejection) return rejection;
      index += token.used;
      continue;
    }
    if (argument === "--") break;
    const word = KUBECTL_COMMAND_ALIASES[path.join(" ")]?.[argument] ?? argument;
    const extended = [...path, word];
    if (!ALL_PATHS.some((candidate) => startsPath(candidate, extended))) break;
    path.push(word);
    index++;
    const floorCommand = KUBECTL_FLOOR_COMMANDS.find((candidate) => samePath(candidate.path, path));
    if (floorCommand) return rejectByFloor(floorCommand.floor, `${commandLine(path)} is never allowed`);
  }

  const command = KUBECTL_COMMANDS.find((candidate) => samePath(candidate.path, path));
  if (!command) {
    const next = args[index];
    if (path.length > 0) {
      const named = next === undefined || isFlagToken(next) ? path : [...path, next];
      return rejectByFloor("unparseable", `${commandLine(named)} is not supported`);
    }
    if (next === undefined || isFlagToken(next)) return rejectByFloor("unparseable", "the invocation names no verb");
    if (KUBECTL_UNSUPPORTED_VERBS.includes(next)) {
      return rejectByFloor("unparseable", `${commandLine([next])} is not supported`);
    }
    return rejectByFloor(
      "local-disk-or-code",
      `${next} is not a kubectl verb, and kubectl would look for a plugin of that name`,
    );
  }

  // The flags and operands of the command.
  const lookup = lookupForCommand(command);
  const operands: string[] = [];
  while (index < args.length) {
    const argument = args[index] ?? "";
    if (argument === "--") {
      return { command, flags, operands, commandArgs: args.slice(index + 1) };
    }
    if (isFlagToken(argument)) {
      const token = readFlagToken(args, index, lookup, command.path);
      if ("kind" in token) return token;
      const rejection = applyFlags(token, flags, command.path);
      if (rejection) return rejection;
      index += token.used;
      continue;
    }
    operands.push(argument);
    index++;
  }
  return { command, flags, operands };
}
