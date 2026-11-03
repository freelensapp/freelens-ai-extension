// The kubectl and helm tools in main: turn a call into a CLI invocation for the
// runner and its result into the text the model reads.

import { DEFAULT_CLI_TIMEOUT_SECONDS, MAX_CLI_TIMEOUT_SECONDS } from "../../../common/agent-tools/kubectl-tool";
import { isRejection, splitAtCommand } from "../../../common/invocation-policy/cli-invocation";
import { parseHelmInvocation } from "../../../common/invocation-policy/helm-canonical-forms";
import { parseKubectlInvocation } from "../../../common/invocation-policy/kubectl-invocation";
import { redactSecretOutput, SECRET_REDACTION_NOTE, type SecretRedaction } from "./secret-redaction";

import type { CliInvocationDetails } from "../../../common/agent-protocol";
import type { CliProgram } from "../../../common/invocation-policy/canonical-form";
import type { CliResult, CliRunner } from "../cli-runner";

/** The arguments of a kubectl or helm call; pi has checked them against the tool's schema. */
export interface CliToolInput {
  args: string[];
  manifest?: string;
  grep?: string;
  timeoutSeconds?: number;
  revealSecrets?: boolean;
}

export interface CliToolContext {
  clusterId: string;
  program: CliProgram;
  runCli: CliRunner;
  /** pi's signal for the tool call: Stop kills the process. */
  signal?: AbortSignal;
  /** The "pod logs tail lines" preference. */
  podLogsTailLines: number;
  /** What the runner reports before the process starts, such as a kubectl download. */
  onProgress: (message: string) => void;
  /** Set for a kubectl get of Secrets, or a helm call that can print a release's manifest, without revealSecrets. */
  secretRedaction?: SecretRedaction;
}

export interface CliToolResult {
  text: string;
  isError: boolean;
  details: CliInvocationDetails;
}

/** The flags of `kubectl logs` that choose how much of the log to read. */
const LOG_WINDOW_FLAGS = ["--tail", "--since", "--since-time"];

// Whether a kubectl call reads logs without choosing how much: the parse of
// the invocation policy decides, so flags before the verb (`-n web logs`) do
// not hide it.
const readsLogsWithoutWindow = (args: readonly string[]): boolean => {
  const invocation = parseKubectlInvocation(args);
  return (
    !isRejection(invocation) &&
    invocation.command.verb === "logs" &&
    !LOG_WINDOW_FLAGS.some((flag) => invocation.flags.has(flag))
  );
};

/**
 * The helm verbs that change a release. helm killed in the middle of one
 * leaves the release pending, so without `timeoutSeconds` they get the
 * longest timeout rather than the default.
 */
const HELM_RELEASE_CHANGES: ReadonlySet<string> = new Set(["upgrade", "rollback", "uninstall"]);

const changesRelease = (args: readonly string[]): boolean => {
  const invocation = parseHelmInvocation(args);
  return !isRejection(invocation) && HELM_RELEASE_CHANGES.has(invocation.command.verb);
};

/** A call made ready to run, or the reason it cannot run. */
export type PreparedCliInvocation =
  | {
      ok: true;
      args: string[];
      manifest?: string;
      timeoutMs: number;
      grep?: RegExp;
      secretRedaction?: SecretRedaction;
    }
  | { ok: false; error: string };

/**
 * Builds the arguments the program runs with. For kubectl: `-f -` for a
 * manifest, and for logs without a tail or a time window the "pod logs tail
 * lines" preference as `--tail`; for a get of Secrets without revealSecrets,
 * `-o json`. The arguments after `--` belong to the command `exec` runs, so
 * they are left alone. helm runs with the agent's arguments as they are, and
 * a change of a release without `timeoutSeconds` with the longest timeout. The
 * invocation policy has checked the arguments and the manifest before; only
 * `grep` is checked here.
 */
export function prepareCliInvocation(
  program: CliProgram,
  input: CliToolInput,
  podLogsTailLines: number,
  secretRedaction?: SecretRedaction,
): PreparedCliInvocation {
  const args = secretRedaction?.kind === "objects" ? secretRedaction.args : input.args;
  const { own, command } = splitAtCommand(args);
  if (program === "kubectl" && input.manifest !== undefined) own.push("-f", "-");
  if (program === "kubectl" && readsLogsWithoutWindow(input.args)) {
    own.push(`--tail=${podLogsTailLines}`);
  }
  let grep: RegExp | undefined;
  try {
    grep = input.grep === undefined ? undefined : new RegExp(input.grep);
  } catch (error) {
    return { ok: false, error: `grep is not a valid regular expression: ${(error as Error).message}` };
  }
  const defaultTimeoutSeconds =
    program === "helm" && changesRelease(input.args) ? MAX_CLI_TIMEOUT_SECONDS : DEFAULT_CLI_TIMEOUT_SECONDS;
  const timeoutSeconds = Math.min(input.timeoutSeconds ?? defaultTimeoutSeconds, MAX_CLI_TIMEOUT_SECONDS);
  return {
    ok: true,
    args: [...own, ...command],
    ...(input.manifest === undefined ? {} : { manifest: input.manifest }),
    timeoutMs: timeoutSeconds * 1000,
    grep,
    ...(secretRedaction ? { secretRedaction } : {}),
  };
}

/** The most of a standard output or error the model gets, in bytes. */
const OUTPUT_CAP_BYTES = 256 * 1024;

// The lines that match the expression, each with its newline.
const grepLines = (text: string, expression: RegExp): string => {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines
    .filter((line) => expression.test(line))
    .map((line) => `${line}\n`)
    .join("");
};

// The head and the tail of an output longer than the cap, with a marker of how
// much was cut between them. A cut may split a line or a character.
const capOutput = (text: string): string => {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= OUTPUT_CAP_BYTES) return text;
  const half = OUTPUT_CAP_BYTES / 2;
  const head = bytes.subarray(0, half).toString("utf8");
  const tail = bytes.subarray(bytes.length - half).toString("utf8");
  return `${head}\n[... ${bytes.length - OUTPUT_CAP_BYTES} of ${bytes.length} bytes cut ...]\n${tail}`;
};

const withoutFinalNewline = (text: string) => (text.endsWith("\n") ? text.slice(0, -1) : text);

// How the process ended: its exit code, or what killed it.
const endLine = (program: CliProgram, result: CliResult, timeoutMs: number): string => {
  if (result.killed === "stopped") return `${program} was stopped before it ended.`;
  if (result.killed === "timeout") return `${program} was killed after its timeout of ${timeoutMs / 1000} s.`;
  return `Exit code: ${result.exitCode}`;
};

// How it ended, the standard output, and the standard error when there is any.
// The output is redacted before grep and the cap.
const resultText = (
  program: CliProgram,
  result: CliResult,
  invocation: { grep?: RegExp; timeoutMs: number; secretRedaction?: SecretRedaction },
): string => {
  const { grep, timeoutMs, secretRedaction } = invocation;
  const output = secretRedaction
    ? redactSecretOutput(result.stdout, secretRedaction)
    : { stdout: result.stdout, redacted: false };
  const stdout = withoutFinalNewline(capOutput(grep ? grepLines(output.stdout, grep) : output.stdout));
  const stderr = withoutFinalNewline(capOutput(result.stderr));
  return [
    endLine(program, result, timeoutMs),
    ...(output.redacted ? [SECRET_REDACTION_NOTE] : []),
    stdout ? `Standard output:\n${stdout}` : "Standard output: (empty)",
    ...(stderr ? [`Standard error:\n${stderr}`] : []),
  ].join("\n\n");
};

/** Runs a call through the CLI runner; throws the reason a call cannot run. */
export async function runCliTool(input: CliToolInput, context: CliToolContext): Promise<CliToolResult> {
  const { program } = context;
  const invocation = prepareCliInvocation(program, input, context.podLogsTailLines, context.secretRedaction);
  if (!invocation.ok) throw new Error(invocation.error);
  const result = await context.runCli({
    clusterId: context.clusterId,
    program,
    args: invocation.args,
    ...(invocation.manifest === undefined ? {} : { manifest: invocation.manifest }),
    timeoutMs: invocation.timeoutMs,
    signal: context.signal,
    onProgress: context.onProgress,
  });
  return {
    text: resultText(program, result, invocation),
    isError: result.exitCode !== 0,
    details: { args: invocation.args, exitCode: result.exitCode },
  };
}
