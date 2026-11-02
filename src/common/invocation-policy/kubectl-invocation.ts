// Parses the arguments of a kubectl CLI invocation with the command line of
// kubectl (`kubectl-commands.ts`).

import { type CliCommandTable, type ParsedInvocation, parseCliInvocation } from "./cli-invocation";
import {
  KUBECTL_COMMAND_ALIASES,
  KUBECTL_COMMANDS,
  KUBECTL_FLOOR_COMMANDS,
  KUBECTL_FLOOR_ONLY_FLAGS,
  KUBECTL_GLOBAL_FLAGS,
  KUBECTL_UNSUPPORTED_VERBS,
  type KubectlCommand,
} from "./kubectl-commands";

import type { FloorRejection } from "./floor";

export { type FlagArgs, isFlagOn } from "./cli-invocation";

export type KubectlInvocation = ParsedInvocation<KubectlCommand>;

const KUBECTL_COMMAND_TABLE: CliCommandTable<KubectlCommand> = {
  program: "kubectl",
  globalFlags: KUBECTL_GLOBAL_FLAGS,
  floorOnlyFlags: KUBECTL_FLOOR_ONLY_FLAGS,
  commands: KUBECTL_COMMANDS,
  floorCommands: KUBECTL_FLOOR_COMMANDS,
  unsupportedVerbs: KUBECTL_UNSUPPORTED_VERBS,
  aliases: KUBECTL_COMMAND_ALIASES,
};

/** Parses the arguments of kubectl into its command, flags and operands, or rejects them by the floor. */
export const parseKubectlInvocation = (args: readonly string[]): KubectlInvocation | FloorRejection =>
  parseCliInvocation(KUBECTL_COMMAND_TABLE, args);
