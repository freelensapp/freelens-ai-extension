// Runs a CLI invocation of the agent against a cluster: the binary Freelens
// runs for the cluster, with Freelens's environment for it, never through a
// shell.

import { execFile } from "node:child_process";

import type { Main } from "@freelensapp/extensions";

/** One CLI invocation for the runner. */
export interface CliInvocation {
  clusterId: string;
  program: "kubectl";
  /** The arguments after the program name, passed to the process as they are. */
  args: readonly string[];
  /** Sent on standard input; any other invocation gets an empty one. */
  manifest?: string;
  /** The process is killed once it has run this long. */
  timeoutMs: number;
  /** pi's signal for the tool call: Stop kills the process. */
  signal?: AbortSignal;
  /** What the runner is doing before the process starts, such as downloading kubectl. */
  onProgress: (message: string) => void;
}

/** How a CLI invocation ended. */
export interface CliResult {
  stdout: string;
  stderr: string;
  /** Null when the runner killed the process. */
  exitCode: number | null;
  /** Why the runner killed the process: pi's signal (Stop) or the timeout. */
  killed?: "stopped" | "timeout";
}

/** Runs one CLI invocation; rejects when the process cannot be started. */
export type CliRunner = (invocation: CliInvocation) => Promise<CliResult>;

/** What the runner uses of the host's `Main.Shell`. */
export interface CliShell {
  getKubectlPath: (clusterId: string, options: Main.Shell.KubectlDownloadOptions) => Promise<string>;
  getEnvironment: (clusterId: string) => Promise<Record<string, string>>;
}

const MIB = 1024 * 1024;
// The most output a process may write, on each stream, before it is killed;
// the tool then cuts what it got to its own cap.
const MAX_OUTPUT_BYTES = 64 * MIB;

const downloadProgress = ({ transferred, total }: Main.Shell.KubectlDownloadProgress) =>
  total
    ? `Downloading kubectl: ${Math.floor((transferred / total) * 100)}%`
    : `Downloading kubectl: ${(transferred / MIB).toFixed(1)} MB`;

/**
 * The runner of main: the kubectl Freelens runs for the cluster, started with
 * `execFile` and the argument array, so no shell ever reads the arguments, and
 * with the cluster's environment, which reaches the cluster through Freelens.
 */
export function createCliRunner(shell: CliShell): CliRunner {
  return async ({ clusterId, args, manifest, timeoutMs, signal, onProgress }) => {
    // A download reports its progress as the bytes arrive: only a changed text is passed on.
    let lastProgress: string | undefined;
    const report = (message: string) => {
      if (message === lastProgress) return;
      lastProgress = message;
      onProgress(message);
    };
    const path = await shell.getKubectlPath(clusterId, {
      onPhase: report,
      onDownloadProgress: (progress) => report(downloadProgress(progress)),
      onProblem: report,
    });
    const env = await shell.getEnvironment(clusterId);
    if (signal?.aborted) return { stdout: "", stderr: "", exitCode: null, killed: "stopped" };

    return new Promise<CliResult>((resolve, reject) => {
      let timedOut = false;
      const child = execFile(
        path,
        [...args],
        { env, signal, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (error, stdout, stderr) => {
          clearTimeout(timer);
          if (timedOut) return resolve({ stdout, stderr, exitCode: null, killed: "timeout" });
          if (signal?.aborted) return resolve({ stdout, stderr, exitCode: null, killed: "stopped" });
          if (!error) return resolve({ stdout, stderr, exitCode: 0 });
          if (typeof error.code === "number") return resolve({ stdout, stderr, exitCode: error.code });
          if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            return reject(new Error(`kubectl wrote more than ${MAX_OUTPUT_BYTES / MIB} MiB of output`));
          }
          reject(error);
        },
      );
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      // A process that exits before reading its input closes the pipe.
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(manifest ?? "");
    });
  };
}
