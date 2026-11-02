// The changes the profile editor makes to the policy profile fields of the
// preferences. Each replaces a field as a whole and never changes it in place:
// main checks the pending approvals again when one of them is replaced.
// Each runs as one MobX action, so a change of several fields is saved once.

import { runInAction } from "mobx";
import { STANDARD_PROFILE } from "../../../../common/invocation-policy/shipped-profiles";

import type { PolicyProfile } from "../../../../common/invocation-policy/policy-profile";
import type { PreferencesStore } from "../../../../common/store";

/** A user profile with a new id, the rules and the fallback level of `source`. */
export const copyPolicyProfile = (source: Omit<PolicyProfile, "id" | "name">, name: string): PolicyProfile => ({
  id: globalThis.crypto.randomUUID(),
  name,
  rules: source.rules.map((rule) => ({ ...rule })),
  fallbackLevel: source.fallbackLevel,
});

export const addUserProfile = (store: PreferencesStore, profile: PolicyProfile): void =>
  runInAction(() => {
    store.userProfiles = [...store.userProfiles, profile];
  });

/** Puts `profile` in the place of the user profile with its id. */
export const replaceUserProfile = (store: PreferencesStore, profile: PolicyProfile): void =>
  runInAction(() => {
    store.userProfiles = store.userProfiles.map((saved) => (saved.id === profile.id ? profile : saved));
  });

export const setDefaultProfile = (store: PreferencesStore, id: string): void =>
  runInAction(() => {
    store.defaultProfileId = id;
  });

/**
 * Deletes a user profile. The clusters assigned to it lose their assignment and
 * get the default profile; when it was the default profile, Standard becomes
 * the default profile.
 */
export const deleteUserProfile = (store: PreferencesStore, id: string): void =>
  runInAction(() => {
    store.userProfiles = store.userProfiles.filter((profile) => profile.id !== id);
    if (Object.values(store.profileAssignments).includes(id)) {
      store.profileAssignments = Object.fromEntries(
        Object.entries(store.profileAssignments).filter(([, profileId]) => profileId !== id),
      );
    }
    if (store.defaultProfileId === id) {
      store.defaultProfileId = STANDARD_PROFILE.id;
    }
  });
