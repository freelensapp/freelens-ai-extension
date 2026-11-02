// A stand-in for the CLI runner of main, for the tests of the agent host. It
// records every CLI invocation and answers it by its arguments, so a test
// asserts what would have run without a cluster or a kubectl binary.

import type { CliInvocation, CliResult, CliRunner } from "../src/main/agent/cli-runner";

/** A CLI invocation as the stand-in received it. */
export type RecordedInvocation = Omit<CliInvocation, "onProgress">;

export interface StandInCliOptions {
  /**
   * What an invocation answers, by its arguments joined with spaces
   * (`"get pods -n web"`); unset fields are empty, with exit code 0. An
   * invocation without an answer fails as kubectl does for an unknown command,
   * with exit code 1.
   */
  answers?: Record<string, Partial<CliResult>>;
  /** Invocations, by the same key, that answer only once their signal aborts, as the runner does on Stop. */
  hang?: readonly string[];
  /** The progress messages every invocation reports before it answers, as a kubectl download does. */
  progress?: readonly string[];
}

export function createStandInCli({ answers = {}, hang = [], progress = [] }: StandInCliOptions = {}) {
  const invocations: RecordedInvocation[] = [];

  const run: CliRunner = async ({ onProgress, ...invocation }) => {
    invocations.push(invocation);
    for (const message of progress) onProgress(message);
    const key = invocation.args.join(" ");
    if (hang.includes(key)) {
      return new Promise<CliResult>((resolve) => {
        const stopped = () => resolve({ stdout: "", stderr: "", exitCode: null, killed: "stopped" });
        if (invocation.signal?.aborted) stopped();
        invocation.signal?.addEventListener("abort", stopped, { once: true });
      });
    }
    const answer = answers[key];
    if (!answer) {
      return { stdout: "", stderr: `error: the stand-in CLI has no answer for "${key}"\n`, exitCode: 1 };
    }
    return { stdout: "", stderr: "", exitCode: 0, ...answer };
  };

  return { run, invocations };
}
