// The kubectl tool in main: turns a call into a CLI invocation for the runner
// and its result into the text the model reads.

import { DEFAULT_CLI_TIMEOUT_SECONDS, MAX_CLI_TIMEOUT_SECONDS } from "../../../common/agent-tools/kubectl-tool";
import { redactSecretOutput, SECRET_REDACTION_NOTE, type SecretRedaction } from "./secret-redaction";

import type { CliInvocationDetails } from "../../../common/agent-protocol";
import type { CliResult, CliRunner } from "../cli-runner";

/** The arguments of a kubectl call; pi has checked them against the tool's schema. */
export interface KubectlToolInput {
  args: string[];
  manifest?: string;
  grep?: string;
  timeoutSeconds?: number;
  revealSecrets?: boolean;
}

export interface KubectlToolContext {
  clusterId: string;
  runCli: CliRunner;
  /** pi's signal for the tool call: Stop kills the process. */
  signal?: AbortSignal;
  /** The "pod logs tail lines" preference. */
  podLogsTailLines: number;
  /** What the runner reports before the process starts, such as a kubectl download. */
  onProgress: (message: string) => void;
  /** Set for a get of Secrets without revealSecrets. */
  secretRedaction?: SecretRedaction;
}

export interface KubectlToolResult {
  text: string;
  isError: boolean;
  details: CliInvocationDetails;
}

/** The flags of `kubectl logs` that choose how much of the log to read. */
const LOG_WINDOW_FLAGS = ["--tail", "--since", "--since-time"];

const setsLogWindow = (arg: string) => LOG_WINDOW_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`));

/** A call made ready to run, or the reason it cannot run. */
export type PreparedKubectlInvocation =
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
 * Builds the arguments kubectl runs with: `-f -` for a manifest, and for logs
 * without a tail or a time window the "pod logs tail lines" preference as
 * `--tail`; for a get of Secrets without revealSecrets, `-o json`. The
 * arguments after `--` belong to the command `exec` runs, so they are left
 * alone. The invocation policy has checked the arguments and the manifest
 * before; only `grep` is checked here.
 */
export function prepareKubectlInvocation(
  input: KubectlToolInput,
  podLogsTailLines: number,
  secretRedaction?: SecretRedaction,
): PreparedKubectlInvocation {
  const args = secretRedaction?.args ?? input.args;
  const end = args.indexOf("--");
  const own = end < 0 ? [...args] : args.slice(0, end);
  const rest = end < 0 ? [] : args.slice(end);
  if (input.manifest !== undefined) own.push("-f", "-");
  if (own[0] === "logs" && !own.some(setsLogWindow)) {
    own.push(`--tail=${podLogsTailLines}`);
  }
  let grep: RegExp | undefined;
  try {
    grep = input.grep === undefined ? undefined : new RegExp(input.grep);
  } catch (error) {
    return { ok: false, error: `grep is not a valid regular expression: ${(error as Error).message}` };
  }
  const timeoutSeconds = Math.min(input.timeoutSeconds ?? DEFAULT_CLI_TIMEOUT_SECONDS, MAX_CLI_TIMEOUT_SECONDS);
  return {
    ok: true,
    args: [...own, ...rest],
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
const endLine = (result: CliResult, timeoutMs: number): string => {
  if (result.killed === "stopped") return "kubectl was stopped before it ended.";
  if (result.killed === "timeout") return `kubectl was killed after its timeout of ${timeoutMs / 1000} s.`;
  return `Exit code: ${result.exitCode}`;
};

// How it ended, the standard output, and the standard error when there is any.
// The output of a get of Secrets is redacted before grep and the cap.
const resultText = (
  result: CliResult,
  invocation: { grep?: RegExp; timeoutMs: number; secretRedaction?: SecretRedaction },
): string => {
  const { grep, timeoutMs, secretRedaction } = invocation;
  const output = secretRedaction ? redactSecretOutput(result.stdout, secretRedaction.print) : result.stdout;
  const stdout = withoutFinalNewline(capOutput(grep ? grepLines(output, grep) : output));
  const stderr = withoutFinalNewline(capOutput(result.stderr));
  return [
    endLine(result, timeoutMs),
    ...(secretRedaction ? [SECRET_REDACTION_NOTE] : []),
    stdout ? `Standard output:\n${stdout}` : "Standard output: (empty)",
    ...(stderr ? [`Standard error:\n${stderr}`] : []),
  ].join("\n\n");
};

/** Runs a call through the CLI runner; throws the reason a call cannot run. */
export async function runKubectl(input: KubectlToolInput, context: KubectlToolContext): Promise<KubectlToolResult> {
  const invocation = prepareKubectlInvocation(input, context.podLogsTailLines, context.secretRedaction);
  if (!invocation.ok) throw new Error(invocation.error);
  const result = await context.runCli({
    clusterId: context.clusterId,
    program: "kubectl",
    args: invocation.args,
    ...(invocation.manifest === undefined ? {} : { manifest: invocation.manifest }),
    timeoutMs: invocation.timeoutMs,
    signal: context.signal,
    onProgress: context.onProgress,
  });
  return {
    text: resultText(result, invocation),
    isError: result.exitCode !== 0,
    details: { args: invocation.args, exitCode: result.exitCode },
  };
}
