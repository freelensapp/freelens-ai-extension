import { kubectlCanonicalForms } from "./kubectl-canonical-forms";
import { parseKubectlInvocation } from "./kubectl-invocation";
import { type ManifestObject, readManifestObjects } from "./manifest";

import type { CanonicalForm, CliProgram } from "./canonical-form";
import type { FloorRejection } from "./floor";
import type { PolicyLevel, PolicyProfile, PolicyRule } from "./policy-profile";
import type { ResourceCatalog } from "./resource-catalog";

export interface InvocationPolicyInput {
  program: CliProgram;
  /** The arguments after the program name. */
  args: readonly string[];
  /** The manifest the invocation sends on standard input; absent without one. */
  manifest?: string;
  revealSecrets: boolean;
  profile: PolicyProfile;
  /** The resources of the cluster, or `BUILT_IN_RESOURCE_CATALOG` without one. */
  catalog: ResourceCatalog;
  /** The namespace of a namespaced target without `-n`: the one the cluster's kubeconfig selects, or `default`. */
  defaultNamespace: string;
}

/** One canonical form of an invocation and the level it gets. */
export interface PolicyTarget {
  form: CanonicalForm;
  level: PolicyLevel;
  /** The rule that decided the level; absent when the profile's fallback level applies. */
  rule?: PolicyRule;
}

/** An invocation that passes the floor: its targets and the most restrictive of their levels. */
export interface PolicyDecision {
  kind: "policy";
  level: PolicyLevel;
  targets: PolicyTarget[];
}

export type InvocationPolicyResult = FloorRejection | PolicyDecision;

/**
 * What happens to a CLI invocation: the floor rejection of the entry that
 * rejects it, or its canonical forms, the level of each by the profile's rules
 * and the level of the invocation.
 */
export function evaluateInvocationPolicy(input: InvocationPolicyInput): InvocationPolicyResult {
  const invocation = parseKubectlInvocation(input.args);
  if ("kind" in invocation) return invocation;

  let manifestObjects: ManifestObject[] | undefined;
  if (input.manifest !== undefined) {
    const objects = readManifestObjects(input.manifest);
    if ("kind" in objects) return objects;
    manifestObjects = objects;
  }

  const forms = kubectlCanonicalForms({
    invocation,
    ...(manifestObjects ? { manifestObjects } : {}),
    revealSecrets: input.revealSecrets,
    catalog: input.catalog,
    defaultNamespace: input.defaultNamespace,
  });
  if ("kind" in forms) return forms;

  const targets = forms.map((form): PolicyTarget => ({ form, level: input.profile.fallbackLevel }));
  return { kind: "policy", level: input.profile.fallbackLevel, targets };
}
