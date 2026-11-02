import { SHIPPED_PROFILES, STANDARD_PROFILE } from "./shipped-profiles";

import type { PolicyProfile } from "./policy-profile";

/** The policy profiles of the preferences and the clusters they are assigned to. */
export interface PolicyProfileSettings {
  userProfiles: readonly PolicyProfile[];
  /** The profile id of each cluster with an assignment, by cluster id. */
  profileAssignments: Readonly<Record<string, string>>;
  /** The profile of every cluster without an assignment. */
  defaultProfileId: string;
}

/** The shipped or user profile with the id, undefined when there is none. */
export const findPolicyProfile = (userProfiles: readonly PolicyProfile[], id: string): PolicyProfile | undefined =>
  SHIPPED_PROFILES.find((profile) => profile.id === id) ?? userProfiles.find((profile) => profile.id === id);

/**
 * The policy profile of a cluster: the one assigned to it, or the default
 * profile for a cluster without an assignment or assigned to a profile that no
 * longer exists. A default profile that no longer exists falls back to Standard.
 */
export function clusterPolicyProfile(settings: PolicyProfileSettings, clusterId: string): PolicyProfile {
  const assigned = Object.hasOwn(settings.profileAssignments, clusterId)
    ? findPolicyProfile(settings.userProfiles, settings.profileAssignments[clusterId]!)
    : undefined;
  return assigned ?? findPolicyProfile(settings.userProfiles, settings.defaultProfileId) ?? STANDARD_PROFILE;
}
