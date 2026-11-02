// The policy profiles that come with Freelens AI. They live in code, have
// fixed ids and cannot be changed; a user profile can copy them.

import type { PolicyLevel, PolicyProfile, PolicyRule } from "./policy-profile";

const rules = (level: PolicyLevel, ...patterns: readonly string[]): PolicyRule[] =>
  patterns.map((pattern) => ({ pattern, level }));

const READ_ONLY_RULES: readonly PolicyRule[] = [
  ...rules(
    "allow",
    "kubectl get *",
    "kubectl describe *",
    "kubectl top *",
    "kubectl events *",
    "kubectl explain",
    "kubectl api-resources",
    "kubectl api-versions",
    "kubectl version",
    "kubectl auth can-i",
    "kubectl diff *",
    "kubectl rollout status *",
    "kubectl rollout history *",
    "helm list *",
    "helm status *",
    "helm history *",
    "helm get values *",
    "helm get manifest *",
    "helm get notes *",
    "helm show *",
    "helm search repo *",
  ),
  ...rules("ask", "kubectl logs *", "kubectl reveal secrets *"),
];

/** Reads of the cluster run, logs and reveals ask, and everything else is denied. */
export const READ_ONLY_PROFILE: PolicyProfile = {
  id: "read-only",
  name: "Read only",
  rules: READ_ONLY_RULES,
  fallbackLevel: "deny",
};

/** The cluster-scoped kinds of Kubernetes whose delete always asks. */
const CLUSTER_SCOPED_KINDS: readonly string[] = [
  "namespaces",
  "nodes",
  "customresourcedefinitions",
  "persistentvolumes",
  "clusterroles",
  "clusterrolebindings",
  "storageclasses",
  "priorityclasses",
  "ingressclasses",
  "apiservices",
  "mutatingwebhookconfigurations",
  "validatingwebhookconfigurations",
];

const STANDARD_ALWAYS_ASK_RULES: readonly PolicyRule[] = rules(
  "alwaysAsk",
  "kubectl exec *",
  "kubectl drain *",
  "helm uninstall *",
  ...CLUSTER_SCOPED_KINDS.map((resource) => `kubectl delete ${resource} *`),
);

/**
 * The rules of Read only, everything else asks, and exec, drain, helm
 * uninstall and deletes of cluster-scoped kinds always ask.
 */
export const STANDARD_PROFILE: PolicyProfile = {
  id: "standard",
  name: "Standard",
  rules: [...READ_ONLY_RULES, ...STANDARD_ALWAYS_ASK_RULES],
  fallbackLevel: "ask",
};

/**
 * The rules of Standard, with logs and the change verbs allowed. Reveals still
 * ask, and the Always ask rules of Standard stay, as they are more specific
 * than the Allow rules.
 */
export const PERMISSIVE_PROFILE: PolicyProfile = {
  id: "permissive",
  name: "Permissive",
  rules: [
    ...READ_ONLY_RULES.filter((rule) => rule.pattern !== "kubectl logs *"),
    ...STANDARD_ALWAYS_ASK_RULES,
    ...rules(
      "allow",
      "kubectl logs *",
      "kubectl apply *",
      "kubectl create *",
      "kubectl replace *",
      "kubectl patch *",
      "kubectl delete *",
      "kubectl scale *",
      "kubectl label *",
      "kubectl annotate *",
      "kubectl set *",
      "kubectl rollout restart *",
      "kubectl rollout undo *",
      "kubectl rollout pause *",
      "kubectl rollout resume *",
      "kubectl cordon *",
      "kubectl uncordon *",
      "kubectl taint *",
      "helm upgrade *",
      "helm rollback *",
    ),
  ],
  fallbackLevel: "ask",
};

export const SHIPPED_PROFILES: readonly PolicyProfile[] = [READ_ONLY_PROFILE, STANDARD_PROFILE, PERMISSIVE_PROFILE];
