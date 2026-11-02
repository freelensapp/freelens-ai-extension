// The dry-run preview of a helm upgrade or rollback that waits for approval. The
// gate runs the call with helm's own `--dry-run=server` and reads the manifest
// of the release, both through the runner of the tool, and the card shows the
// diff of the release's manifest, current against what the call would make of
// it. An upgrade's dry run prints the release it would make (`-o json`); a
// rollback's prints none, so its manifest is that of the revision it goes back
// to, which helm applies as it is. The preview goes to the card only, never to
// the model: a manifest can hold Secret values.

import { parseHelmInvocation } from "../../../common/invocation-policy/helm-canonical-forms";
import { unifiedDiff } from "./line-diff";
import { type PreviewOutcome, previewFailure, runPreviewInvocation } from "./preview-invocation";

import type { CanonicalForm } from "../../../common/invocation-policy/canonical-form";
import type { DryRunVerb } from "../../../common/invocation-policy/dry-run-verbs";
import type { CliResult } from "../cli-runner";
import type { ClusterReadContext } from "./cluster-resources";

/** A helm call made ready to run, as the dry run repeats it. */
export interface HelmPreviewCall {
  /** The arguments that will run. */
  args: readonly string[];
  /** `upgrade` or `rollback`. */
  verb: DryRunVerb;
  /** The canonical form of the release. */
  target: CanonicalForm;
}

// What helm answers to a call that would fail the same way: the release or the
// revision does not exist, the chart does not render with the values, the
// objects are invalid, or the server or an admission webhook rejects them.
// Every other error, a cluster that cannot be reached among them, leaves the
// preview unavailable instead, and the user is still asked.
const HELM_REJECTION =
  /release: not found|has no deployed releases|release has no \d+ version|invalid release revision|admission webhook "[^"]*" denied the request|\bis invalid\b|\bis forbidden\b|\balready exists\b|Operation cannot be fulfilled|error validating data|\btemplate: |parse error at|execution error at/;

const UNRECOGNIZED = "helm printed a dry run the preview does not recognize";

/** A manifest with exactly one final newline: `helm get manifest` prints one more than the release holds. */
const normalized = (manifest: string): string => {
  const trimmed = manifest.replace(/\n+$/, "");
  return trimmed === "" ? "" : `${trimmed}\n`;
};

/** The manifest of the release an upgrade's dry run prints with `-o json`, undefined for any other output. */
const dryRunManifest = (stdout: string): string | undefined => {
  try {
    const release: unknown = JSON.parse(stdout);
    if (typeof release !== "object" || release === null || !("name" in release)) return undefined;
    return "manifest" in release && typeof release.manifest === "string" ? release.manifest : "";
  } catch {
    return undefined;
  }
};

/** The latest revision of `helm history -o json`, undefined for any other output. */
const latestRevision = (stdout: string): number | undefined => {
  try {
    const history: unknown = JSON.parse(stdout);
    if (!Array.isArray(history)) return undefined;
    const revisions = history.flatMap((entry: unknown) =>
      typeof entry === "object" && entry !== null && "revision" in entry && typeof entry.revision === "number"
        ? [entry.revision]
        : [],
    );
    return revisions.length > 0 ? Math.max(...revisions) : undefined;
  } catch {
    return undefined;
  }
};

/** The flags that name the release's namespace, as the canonical form has it. */
const namespaceArgs = (target: CanonicalForm): string[] =>
  target.namespace === undefined ? [] : ["-n", target.namespace];

/**
 * Runs the dry run of a helm upgrade or rollback and reads the manifests it
 * changes, and makes the card's preview of them: the diff of the release's
 * manifest, or the reason there is none. A dry run that fails the way the call
 * would is the rejection for the model, and nobody is asked.
 */
export async function previewHelmInvocation(
  context: ClusterReadContext,
  call: HelmPreviewCall,
): Promise<PreviewOutcome> {
  const { verb, target } = call;
  const release = target.name ?? "";
  const run = (args: readonly string[]) => runPreviewInvocation(context, "helm", args);
  const stopped = (result: CliResult) => result.killed === "stopped" || context.signal?.aborted === true;

  const output = verb.acceptsYamlOutput ? ["-o", "json"] : [];
  const dryRun = await run([...call.args, "--dry-run=server", ...output]);
  if (stopped(dryRun)) return { kind: "stopped" };
  const dryRunFailed = dryRun.exitCode !== 0;
  if (dryRunFailed && dryRun.killed === undefined && HELM_REJECTION.test(dryRun.stderr)) {
    return { kind: "rejected", message: dryRun.stderr.trim() };
  }

  // The revision a rollback goes back to: the one it names, else the one before the latest, as helm takes it.
  let revision: number | undefined;
  let revisionFailure: string | undefined;
  if (!verb.acceptsYamlOutput && !dryRunFailed) {
    const invocation = parseHelmInvocation(call.args);
    const named = "kind" in invocation ? 0 : Number(invocation.operands[1] ?? "0");
    if (named > 0) {
      revision = named;
    } else {
      const history = await run(["history", release, ...namespaceArgs(target), "--max", "1", "-o", "json"]);
      if (stopped(history)) return { kind: "stopped" };
      const latest = history.exitCode === 0 ? latestRevision(history.stdout) : undefined;
      if (latest === undefined) {
        revisionFailure =
          history.exitCode === 0 ? UNRECOGNIZED : previewFailure("reading the history of the release", history);
      } else {
        revision = latest - 1;
      }
    }
  }

  const readManifest = ["get", "manifest", release, ...namespaceArgs(target)];
  const current = await run(readManifest);
  if (stopped(current)) return { kind: "stopped" };
  const currentManifest = current.exitCode === 0 ? normalized(current.stdout) : undefined;
  const unavailable = (reason: string): PreviewOutcome => ({
    kind: "preview",
    preview: { kind: "unavailable", reason, ...(currentManifest ? { backup: currentManifest } : {}) },
  });

  if (dryRunFailed) return unavailable(previewFailure("the dry run", dryRun));
  if (currentManifest === undefined) return unavailable(previewFailure("reading the manifest of the release", current));
  if (revisionFailure !== undefined) return unavailable(revisionFailure);

  let after: string | undefined;
  if (revision === undefined) {
    after = dryRunManifest(dryRun.stdout);
    if (after === undefined) return unavailable(UNRECOGNIZED);
  } else {
    const previous = await run([...readManifest, "--revision", String(revision)]);
    if (stopped(previous)) return { kind: "stopped" };
    if (previous.exitCode !== 0) {
      return unavailable(previewFailure(`reading the manifest of revision ${revision}`, previous));
    }
    after = previous.stdout;
  }
  const diff = unifiedDiff(currentManifest, normalized(after), { before: "current", after: "dry run" });
  return { kind: "preview", preview: { kind: "diffs", diffs: [{ target, diff }] } };
}
