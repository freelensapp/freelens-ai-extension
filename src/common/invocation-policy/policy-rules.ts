import { KUBECTL_COMMANDS } from "./kubectl-commands";
import { mostRestrictiveLevel, type PolicyLevel, type PolicyProfile, type PolicyRule } from "./policy-profile";
import { findCatalogResource, type ResourceCatalog } from "./resource-catalog";

import type { CanonicalForm } from "./canonical-form";

/** The verbs of kubectl's canonical forms. */
const KUBECTL_VERBS: ReadonlySet<string> = new Set([...KUBECTL_COMMANDS.map((command) => command.verb), "reveal"]);

/** The first words of the verbs of two words; `rollout` and `auth` are no verb alone. */
const TWO_WORD_VERB_STARTS: ReadonlySet<string> = new Set(
  [...KUBECTL_VERBS].filter((verb) => verb.includes(" ")).map((verb) => verb.split(" ")[0] ?? ""),
);

/** A rule's pattern, by the parts of the canonical form; an omitted part is undefined. */
interface PolicyPattern {
  program: string;
  verb?: string;
  resource?: string;
  name?: string;
  namespace?: string;
}

/** Splits a pattern into its parts; undefined when it is not of the shape of a canonical form. */
const parsePattern = (pattern: string, catalog: ResourceCatalog): PolicyPattern | undefined => {
  const tokens = pattern.trim().split(/\s+/).filter(Boolean);
  const positional: string[] = [];
  let namespace: string | undefined;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (token === "-n" || token === "--namespace") {
      namespace = tokens[++index];
      if (namespace === undefined) return undefined;
    } else if (token.startsWith("--namespace=")) {
      namespace = token.slice("--namespace=".length);
    } else if (token.startsWith("-n") && token.length > 2) {
      namespace = token.slice(token[2] === "=" ? 3 : 2);
    } else if (token.startsWith("-")) {
      return undefined;
    } else {
      positional.push(token);
    }
  }

  const [program, first, ...rest] = positional;
  if (program === undefined) return undefined;
  let verb = first;
  if (first !== undefined && TWO_WORD_VERB_STARTS.has(first)) {
    const second = rest[0];
    if (second !== undefined && (KUBECTL_VERBS.has(`${first} ${second}`) || second.includes("*"))) {
      verb = `${first} ${second}`;
      rest.shift();
    } else if (!KUBECTL_VERBS.has(first)) {
      verb = `${first} *`;
    }
  }
  const [resource, name, ...extra] = rest;
  if (extra.length > 0) return undefined;
  const normalized =
    resource === undefined || resource.includes("*") ? resource : findCatalogResource(catalog, resource)?.name;
  return {
    program,
    ...(verb === undefined ? {} : { verb }),
    ...(resource === undefined ? {} : { resource: normalized ?? resource }),
    ...(name === undefined ? {} : { name }),
    ...(namespace === undefined ? {} : { namespace }),
  };
};

const isWildcard = (part: string | undefined): boolean => part === undefined || part === "*";

const globPattern = (glob: string): RegExp =>
  new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

/**
 * Whether a part of a pattern matches a part of the canonical form. A form's
 * `*` (every name, every namespace) is matched only by `*` or an omitted part,
 * and so is a part the form does not have.
 */
const matchesPart = (part: string | undefined, value: string | undefined): boolean => {
  if (isWildcard(part)) return true;
  if (value === undefined || value === "*" || part === undefined) return false;
  return part.includes("*") ? globPattern(part).test(value) : part === value;
};

/** 2 for a literal, 1 for a glob, 0 for `*` or an omitted part. */
const weightOf = (part: string | undefined): number => (isWildcard(part) ? 0 : part?.includes("*") ? 1 : 2);

const specificityOf = (pattern: PolicyPattern): number =>
  [pattern.program, pattern.verb, pattern.resource, pattern.name, pattern.namespace].reduce(
    (sum, part) => sum + weightOf(part),
    0,
  );

const matchesForm = (pattern: PolicyPattern, form: CanonicalForm): boolean =>
  pattern.program === form.program &&
  matchesPart(pattern.verb, form.verb) &&
  matchesPart(pattern.resource, form.resource) &&
  matchesPart(pattern.name, form.name) &&
  matchesPart(pattern.namespace, form.namespace);

export interface RuleDecision {
  level: PolicyLevel;
  /** Absent when the profile's fallback level applies. */
  rule?: PolicyRule;
}

/**
 * The level a profile gives one canonical form: the most specific rule that
 * matches decides, the most restrictive on a tie, and the fallback level
 * applies when none matches.
 */
export function decideByRules(profile: PolicyProfile, form: CanonicalForm, catalog: ResourceCatalog): RuleDecision {
  let best: { rule: PolicyRule; specificity: number } | undefined;
  for (const rule of profile.rules) {
    const pattern = parsePattern(rule.pattern, catalog);
    if (!pattern || !matchesForm(pattern, form)) continue;
    const specificity = specificityOf(pattern);
    if (
      !best ||
      specificity > best.specificity ||
      (specificity === best.specificity && mostRestrictiveLevel(rule.level, best.rule.level) !== best.rule.level)
    ) {
      best = { rule, specificity };
    }
  }
  return best ? { level: best.rule.level, rule: best.rule } : { level: profile.fallbackLevel };
}
