// The policy profile fields of the preferences as saved. Kept free of host and
// MobX imports so it is unit-tested alone.

import {
  POLICY_LEVELS,
  type PolicyLevel,
  type PolicyProfile,
  type PolicyRule,
} from "../invocation-policy/policy-profile";
import { SHIPPED_PROFILES, STANDARD_PROFILE } from "../invocation-policy/shipped-profiles";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPolicyLevel = (value: unknown): value is PolicyLevel => POLICY_LEVELS.includes(value as PolicyLevel);

const loadRule = (value: unknown): PolicyRule[] =>
  isRecord(value) && typeof value.pattern === "string" && isPolicyLevel(value.level)
    ? [{ pattern: value.pattern, level: value.level }]
    : [];

/**
 * The saved user profiles. A profile that is not whole, or whose id a shipped
 * profile or an earlier user profile has, is left out, and so is a rule without
 * a pattern or a level.
 */
export function loadUserProfiles(saved: unknown): PolicyProfile[] {
  if (!Array.isArray(saved)) return [];
  const ids = new Set(SHIPPED_PROFILES.map((profile) => profile.id));
  return saved.flatMap((value): PolicyProfile[] => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      ids.has(value.id) ||
      typeof value.name !== "string" ||
      !Array.isArray(value.rules) ||
      !isPolicyLevel(value.fallbackLevel)
    ) {
      return [];
    }
    ids.add(value.id);
    return [
      { id: value.id, name: value.name, rules: value.rules.flatMap(loadRule), fallbackLevel: value.fallbackLevel },
    ];
  });
}

/** The saved profile id of each cluster, by cluster id. */
export function loadProfileAssignments(saved: unknown): Record<string, string> {
  if (!isRecord(saved)) return {};
  return Object.fromEntries(Object.entries(saved).filter(([, id]) => typeof id === "string")) as Record<string, string>;
}

/** The saved default profile id; Standard until the user chooses another. */
export const loadDefaultProfileId = (saved: unknown): string =>
  typeof saved === "string" && saved !== "" ? saved : STANDARD_PROFILE.id;
