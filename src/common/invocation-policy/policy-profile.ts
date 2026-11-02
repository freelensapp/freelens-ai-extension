/** What happens to a CLI invocation that passes the floor. */
export type PolicyLevel = "allow" | "ask" | "alwaysAsk" | "deny";

/** The levels from the least to the most restrictive. */
export const POLICY_LEVELS: readonly PolicyLevel[] = ["allow", "ask", "alwaysAsk", "deny"];

/** The more restrictive of two levels. */
export const mostRestrictiveLevel = (a: PolicyLevel, b: PolicyLevel): PolicyLevel =>
  POLICY_LEVELS.indexOf(a) >= POLICY_LEVELS.indexOf(b) ? a : b;

/**
 * A pattern over the canonical form, `kubectl delete pods web-* -n dev`, and the
 * level it gives. Each part is a literal, a glob or `*`, and omitted trailing
 * parts mean `*`.
 */
export interface PolicyRule {
  pattern: string;
  level: PolicyLevel;
}

/** A named set of policy rules with a fallback level; the order of the rules does not matter. */
export interface PolicyProfile {
  id: string;
  name: string;
  rules: readonly PolicyRule[];
  fallbackLevel: PolicyLevel;
}
