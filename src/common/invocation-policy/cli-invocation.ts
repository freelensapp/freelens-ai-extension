// Parses the arguments of a CLI invocation the way kubectl's and helm's command
// line library does: flags anywhere after the verb words, global flags also
// before them, every spelling of a flag (`-n prod`, `-nprod`, `-n=prod`,
// `--namespace prod`, `--namespace=prod`), grouped short flags (`-it`) and
// `--` before a command. What it cannot place is a floor rejection.

import { type FloorEntryId, type FloorRejection, rejectByFloor } from "./floor";

import type { CliProgram } from "./canonical-form";
import type { FlagSpec } from "./cli-flags";

/** What the parser needs of a command: the words that name it and its flags. */
export interface CliCommandSpec {
  /** The words that name the command: `["rollout", "restart"]`. */
  path: readonly string[];
  flags: readonly FlagSpec[];
}

/** A command the floor rejects whatever its arguments are. */
export interface CliFloorCommand {
  path: readonly string[];
  floor: FloorEntryId;
}

/** The command line of a CLI, as its `--help` documents it. */
export interface CliCommandTable<Command extends CliCommandSpec> {
  program: CliProgram;
  /** The flags of every command, which may also come before the verb words. */
  globalFlags: readonly FlagSpec[];
  /**
   * Flags of the floor that a command may not have: the CLI would reject them
   * as unknown, and the floor names why they are never allowed.
   */
  floorOnlyFlags: readonly FlagSpec[];
  commands: readonly Command[];
  floorCommands: readonly CliFloorCommand[];
  /** Verbs of the CLI that the parser does not take, so that they are not taken for plugins. */
  unsupportedVerbs: readonly string[];
  /** The aliases of command words, by the path of the command they belong to (`""` for the verb). */
  aliases: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface ParsedInvocation<Command extends CliCommandSpec> {
  command: Command;
  /** The value of each flag that is set, by its long spelling; the last one wins, and a boolean flag without a value is `"true"`. */
  flags: ReadonlyMap<string, string>;
  /** The positional arguments past the verb words and before `--`. */
  operands: readonly string[];
  /** Where each flag token sits in the arguments, in order, so that main can change one flag of the invocation. */
  flagArgs: readonly FlagArgs[];
  /** The arguments after `--`, the command of `exec` or `run`; absent without `--`. */
  commandArgs?: readonly string[];
}

/** One flag token in the arguments: `-o yaml`, `--output=yaml` or the grouped `-Ao yaml`. */
export interface FlagArgs {
  /** The index of the token in the arguments. */
  index: number;
  /** How many arguments the token uses, its value included. */
  count: number;
  /** The flags the token sets, by their long spelling. */
  longs: readonly string[];
}

/** The spellings of `false` that a boolean flag takes. */
const FALSE_VALUES: ReadonlySet<string> = new Set(["false", "0", "f", "F", "FALSE", "False"]);

/** Whether a flag is set and, for a boolean flag, not set to false. */
export const isFlagOn = (invocation: { flags: ReadonlyMap<string, string> }, long: string): boolean => {
  const value = invocation.flags.get(long);
  return value !== undefined && !FALSE_VALUES.has(value);
};

/**
 * The arguments before `--`, the program's own, and the rest from `--` on,
 * which belong to the command of `exec` or `run`.
 */
export const splitAtCommand = (args: readonly string[]): { own: string[]; command: string[] } => {
  const end = args.indexOf("--");
  return end < 0 ? { own: [...args], command: [] } : { own: args.slice(0, end), command: args.slice(end) };
};

/** Whether a value is a floor rejection rather than what was asked for. */
export const isRejection = (value: unknown): value is FloorRejection =>
  typeof value === "object" && value !== null && "kind" in value && value.kind === "floor";

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

interface FlagToken {
  /** The flags the token sets, with their values. */
  set: { found: FoundFlag; spelling: string; value: string }[];
  /** How many arguments the token used, its value included. */
  used: number;
}

const isFlagToken = (argument: string): boolean => argument.startsWith("-") && argument !== "-";

const samePath = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((word, position) => word === b[position]);

const startsPath = (path: readonly string[], prefix: readonly string[]): boolean =>
  prefix.length <= path.length && prefix.every((word, position) => word === path[position]);

const flagArgsOf = (token: FlagToken, index: number): FlagArgs => ({
  index,
  count: token.used,
  longs: token.set.map(({ found }) => found.spec.long),
});

/** Parses the arguments of a CLI into its command, flags and operands, or rejects them by the floor. */
export function parseCliInvocation<Command extends CliCommandSpec>(
  table: CliCommandTable<Command>,
  args: readonly string[],
): ParsedInvocation<Command> | FloorRejection {
  const { program } = table;
  const commandLine = (path: readonly string[]): string => [program, ...path].join(" ");
  const unsupportedFlag = (spelling: string, path: readonly string[]): FloorRejection =>
    rejectByFloor(
      "unparseable",
      `${spelling} is not a supported flag of ${commandLine(path)}; run it without ${spelling}`,
    );

  const lookupGlobal = lookupIn([table.globalFlags, "global"], [table.floorOnlyFlags, "floor-only"]);
  const lookupForCommand = (command: Command): FlagLookup =>
    lookupIn([command.flags, "command"], [table.globalFlags, "global"], [table.floorOnlyFlags, "floor-only"]);

  const allPaths: readonly (readonly string[])[] = [
    ...table.commands.map((command) => command.path),
    ...table.floorCommands.map((command) => command.path),
  ];

  /** The path of a subcommand that an operand names after flags, such as `deployment` of `create -n web deployment`. */
  const subcommandAfterFlags = (path: readonly string[], operand: string): string[] | undefined => {
    const subcommand = [...path, table.aliases[path.join(" ")]?.[operand] ?? operand];
    return allPaths.some((candidate) => startsPath(candidate, subcommand)) ? subcommand : undefined;
  };

  /** Reads the flag token at `index`: one long flag, or one or more grouped short flags. */
  const readFlagToken = (index: number, lookup: FlagLookup, path: readonly string[]): FlagToken | FloorRejection => {
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
        return rejectByFloor(spec.floor, `${spec.floorRejects ? `${spelling} ${value}` : spelling} is never allowed`);
      }
      if (found.source === "floor-only") return unsupportedFlag(spelling, path);
      flags.set(spec.long, value);
    }
    return undefined;
  };

  const flags = new Map<string, string>();
  const flagArgs: FlagArgs[] = [];
  const path: string[] = [];
  let index = 0;

  // The verb words, with global flags before and between them. Once the words
  // name a command, a flag ends them: `logs -f` is `--follow`, not `--filename`.
  while (index < args.length) {
    const argument = args[index] ?? "";
    if (isFlagToken(argument) && argument !== "--") {
      if (table.commands.some((command) => samePath(command.path, path))) break;
      const token = readFlagToken(index, lookupGlobal, path);
      if ("kind" in token) return token;
      const rejection = applyFlags(token, flags, path);
      if (rejection) return rejection;
      flagArgs.push(flagArgsOf(token, index));
      index += token.used;
      continue;
    }
    if (argument === "--") break;
    const word = table.aliases[path.join(" ")]?.[argument] ?? argument;
    const extended = [...path, word];
    if (!allPaths.some((candidate) => startsPath(candidate, extended))) break;
    path.push(word);
    index++;
    const floorCommand = table.floorCommands.find((candidate) => samePath(candidate.path, path));
    if (floorCommand) return rejectByFloor(floorCommand.floor, `${commandLine(path)} is never allowed`);
  }

  const command = table.commands.find((candidate) => samePath(candidate.path, path));
  if (!command) {
    const next = args[index];
    if (path.length > 0) {
      const named = next === undefined || isFlagToken(next) ? path : [...path, next];
      return rejectByFloor("unparseable", `${commandLine(named)} is not supported`);
    }
    if (next === undefined || isFlagToken(next)) return rejectByFloor("unparseable", "the invocation names no verb");
    if (table.unsupportedVerbs.includes(next)) {
      return rejectByFloor("unparseable", `${commandLine([next])} is not supported`);
    }
    return rejectByFloor(
      "local-disk-or-code",
      `${next} is not a ${program} verb, and ${program} would look for a plugin of that name`,
    );
  }

  // The flags and operands of the command.
  const lookup = lookupForCommand(command);
  const operands: string[] = [];
  while (index < args.length) {
    const argument = args[index] ?? "";
    if (argument === "--") {
      return { command, flags, operands, flagArgs, commandArgs: args.slice(index + 1) };
    }
    if (isFlagToken(argument)) {
      const token = readFlagToken(index, lookup, command.path);
      if ("kind" in token) return token;
      const rejection = applyFlags(token, flags, command.path);
      if (rejection) return rejection;
      flagArgs.push(flagArgsOf(token, index));
      index += token.used;
      continue;
    }
    const subcommand = operands.length === 0 ? subcommandAfterFlags(path, argument) : undefined;
    if (subcommand) return rejectByFloor("unparseable", `write ${commandLine(subcommand)} before the flags`);
    operands.push(argument);
    index++;
  }
  return { command, flags, operands, flagArgs };
}
