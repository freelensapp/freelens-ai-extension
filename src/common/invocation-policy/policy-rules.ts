import { isCliProgram } from "./canonical-form";
import { HELM_COMMANDS } from "./helm-commands";
import { KUBECTL_COMMANDS } from "./kubectl-commands";
import { mostRestrictiveLevel, type PolicyLevel, type PolicyProfile, type PolicyRule } from "./policy-profile";
import { findCatalogResource, type ResourceCatalog } from "./resource-catalog";

import type { CanonicalForm, CliProgram } from "./canonical-form";

/** The verbs of the canonical forms of each program. */
const VERBS: Readonly<Record<CliProgram, ReadonlySet<string>>> = {
  kubectl: new Set([...KUBECTL_COMMANDS.map((command) => command.verb), "reveal"]),
  helm: new Set(HELM_COMMANDS.map((command) => command.verb)),
};

/** The first words of the verbs of two words; `rollout`, `auth`, `get` of helm and `search` are no verb alone. */
const TWO_WORD_VERB_STARTS: Readonly<Record<CliProgram, ReadonlySet<string>>> = {
  kubectl: twoWordVerbStarts(VERBS.kubectl),
  helm: twoWordVerbStarts(VERBS.helm),
};

function twoWordVerbStarts(verbs: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...verbs].filter((verb) => verb.includes(" ")).map((verb) => verb.split(" ")[0] ?? ""));
}

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
  if (program === undefined || !isCliProgram(program)) return undefined;
  const verbs = VERBS[program];
  let verb = first;
  if (first !== undefined && TWO_WORD_VERB_STARTS[program].has(first)) {
    const second = rest[0];
    if (second !== undefined && (verbs.has(`${first} ${second}`) || second.includes("*"))) {
      verb = `${first} ${second}`;
      rest.shift();
    } else if (!verbs.has(first)) {
      verb = `${first} *`;
    }
  }
  const [resource, name, ...extra] = rest;
  if (extra.length > 0) return undefined;
  // The resources of helm, releases and charts, are not resources of the cluster.
  const normalized =
    resource === undefined || resource.includes("*") || program !== "kubectl"
      ? resource
      : findCatalogResource(catalog, resource)?.name;
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
