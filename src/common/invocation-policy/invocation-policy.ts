import { type FloorRejection, rejectByFloor } from "./floor";
import { helmCanonicalForms, parseHelmInvocation } from "./helm-canonical-forms";
import { kubectlCanonicalForms } from "./kubectl-canonical-forms";
import { parseKubectlInvocation } from "./kubectl-invocation";
import { checkSecretOutput } from "./kubectl-secret-output";
import { type ManifestObject, readManifestObjects } from "./manifest";
import { mostRestrictiveLevel, type PolicyLevel, type PolicyProfile, type PolicyRule } from "./policy-profile";
import { decideByRules } from "./policy-rules";

import type { CanonicalForm, CliProgram } from "./canonical-form";
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
  const forms = input.program === "helm" ? helmForms(input) : kubectlForms(input);
  if ("kind" in forms) return forms;
  const targets = forms.map((form): PolicyTarget => ({ form, ...decideByRules(input.profile, form, input.catalog) }));
  const level = targets.map((target) => target.level).reduce(mostRestrictiveLevel);
  return { kind: "policy", level, targets };
}

/** The canonical forms of a helm invocation; helm takes no manifest, and `revealSecrets` names none of its targets. */
const helmForms = (input: InvocationPolicyInput): CanonicalForm[] | FloorRejection => {
  const invocation = parseHelmInvocation(input.args);
  if ("kind" in invocation) return invocation;
  if (input.manifest !== undefined) {
    return rejectByFloor("manifest", `helm ${invocation.command.path.join(" ")} takes no manifest`);
  }
  return helmCanonicalForms(invocation, input.defaultNamespace);
};

/** The canonical forms of a kubectl invocation, with a `reveal` form for each Secret whose values it prints. */
const kubectlForms = (input: InvocationPolicyInput): CanonicalForm[] | FloorRejection => {
  const invocation = parseKubectlInvocation(input.args);
  if ("kind" in invocation) return invocation;

  let manifestObjects: ManifestObject[] | undefined;
  if (input.manifest !== undefined) {
    if (!invocation.command.takesManifest) {
      return rejectByFloor(
        "manifest",
        `kubectl ${invocation.command.path.join(" ")} takes no manifest; only apply, create, replace, delete and diff do`,
      );
    }
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
  return checkSecretOutput(invocation, forms, input.revealSecrets);
};
