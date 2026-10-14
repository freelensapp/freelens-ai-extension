/**
 * The shape of the Kubernetes `/version` endpoint response (apimachinery
 * `version.Info`). Every field is optional because older or customized API
 * servers may omit some of them.
 */
export interface KubernetesVersionInfo {
  major?: string;
  minor?: string;
  gitVersion?: string;
  gitCommit?: string;
  gitTreeState?: string;
  buildDate?: string;
  goVersion?: string;
  compiler?: string;
  platform?: string;
}

/**
 * A compact, model-friendly summary of the cluster version. Only fields that
 * are actually reported by the API server are included.
 */
export interface ClusterVersionSummary {
  version: string;
  major?: string;
  minor?: string;
  gitCommit?: string;
  buildDate?: string;
  goVersion?: string;
  platform?: string;
}

/** Return the trimmed string when it is a non-empty string, otherwise undefined. */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Build a compact summary from the raw `/version` payload. `gitVersion` (for
 * example "v1.29.2") is the human-readable cluster version; when it is missing
 * we fall back to "<major>.<minor>" and finally to "unknown".
 */
export function summarizeClusterVersion(info: KubernetesVersionInfo): ClusterVersionSummary {
  const major = nonEmptyString(info.major);
  const minor = nonEmptyString(info.minor);
  const gitVersion = nonEmptyString(info.gitVersion);
  const version = gitVersion ?? (major && minor ? `${major}.${minor}` : "unknown");
  return {
    version,
    major,
    minor,
    gitCommit: nonEmptyString(info.gitCommit),
    buildDate: nonEmptyString(info.buildDate),
    goVersion: nonEmptyString(info.goVersion),
    platform: nonEmptyString(info.platform),
  };
}
