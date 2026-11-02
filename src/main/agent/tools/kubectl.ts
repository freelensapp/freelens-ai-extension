// The kubectl tool in main: turns a call into a CLI invocation for the runner
// and its result into the text the model reads.

import { DEFAULT_CLI_TIMEOUT_SECONDS, MAX_CLI_TIMEOUT_SECONDS } from "../../../common/agent-tools/kubectl-tool";

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
}

export interface KubectlToolResult {
  text: string;
  isError: boolean;
  details: CliInvocationDetails;
}

/** The verbs that take objects with `-f`, which the tool sends a manifest to. */
const MANIFEST_VERBS: ReadonlySet<string> = new Set(["apply", "create", "replace", "delete", "diff"]);

/** The flags of `kubectl logs` that choose how much of the log to read. */
const LOG_WINDOW_FLAGS = ["--tail", "--since", "--since-time"];

const setsLogWindow = (arg: string) => LOG_WINDOW_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`));

/** A call made ready to run, or the reason it cannot run. */
export type PreparedKubectlInvocation =
  | { ok: true; args: string[]; manifest?: string; timeoutMs: number; grep?: RegExp }
  | { ok: false; error: string };

// `-f`, its value attached or not, and `--filename`: kubectl would read a file
// of the user's disk. The tool adds `-f -` itself for a manifest.
const readsFile = (arg: string) =>
  arg === "--filename" || arg.startsWith("--filename=") || (arg.startsWith("-f") && !arg.startsWith("--"));

/**
 * Checks a call and builds the arguments kubectl runs with: `-f -` for a
 * manifest, and for logs without a tail or a time window the "pod logs tail
 * lines" preference as `--tail`. The arguments after `--` belong to the
 * command `exec` runs, so they are left alone.
 */
export function prepareKubectlInvocation(input: KubectlToolInput, podLogsTailLines: number): PreparedKubectlInvocation {
  const end = input.args.indexOf("--");
  const own = end < 0 ? [...input.args] : input.args.slice(0, end);
  const rest = end < 0 ? [] : input.args.slice(end);
  if (own.some(readsFile)) {
    return { ok: false, error: "kubectl reads no files: send the objects in manifest instead of -f or --filename." };
  }
  if (input.manifest !== undefined) {
    if (!MANIFEST_VERBS.has(own[0] ?? "")) {
      return {
        ok: false,
        error: "A manifest is accepted only with apply, create, replace, delete or diff, as the first argument.",
      };
    }
    own.push("-f", "-");
  }
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
const resultText = (result: CliResult, invocation: { grep?: RegExp; timeoutMs: number }): string => {
  const { grep, timeoutMs } = invocation;
  const stdout = withoutFinalNewline(capOutput(grep ? grepLines(result.stdout, grep) : result.stdout));
  const stderr = withoutFinalNewline(capOutput(result.stderr));
  return [
    endLine(result, timeoutMs),
    stdout ? `Standard output:\n${stdout}` : "Standard output: (empty)",
    ...(stderr ? [`Standard error:\n${stderr}`] : []),
  ].join("\n\n");
};

/** Runs a call through the CLI runner; throws the reason a call cannot run. */
export async function runKubectl(input: KubectlToolInput, context: KubectlToolContext): Promise<KubectlToolResult> {
  const invocation = prepareKubectlInvocation(input, context.podLogsTailLines);
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
