import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import * as React from "react";
import { findPolicyProfile } from "../../../../common/invocation-policy/profile-assignment";
import { SHIPPED_PROFILES, STANDARD_PROFILE } from "../../../../common/invocation-policy/shipped-profiles";
import { PreferencesStore } from "../../../../common/store";
import { NewProfileForm } from "./new-profile-form";
import {
  addUserProfile,
  copyPolicyProfile,
  deleteUserProfile,
  replaceUserProfile,
  setDefaultProfile,
} from "./policy-profile-edits";
import styles from "./policy-profiles.module.scss";
import { ProfileDetails } from "./profile-details";

import type { SingleValue } from "react-select";

import type { PolicyProfile } from "../../../../common/invocation-policy/policy-profile";

const { observer } = MobxReact;
const { useState } = React;

const {
  Component: { Button, Select },
} = Renderer;

type SelectOption<T> = Renderer.Component.SelectOption<T>;

const SHIPPED_IDS: ReadonlySet<string> = new Set(SHIPPED_PROFILES.map((profile) => profile.id));

const deleteQuestion = (profile: PolicyProfile, isDefault: boolean): string =>
  isDefault
    ? `Delete the policy profile "${profile.name}"? It is the default profile: Standard becomes the default profile, and every cluster that used "${profile.name}" gets it.`
    : `Delete the policy profile "${profile.name}"? Every cluster that uses it gets the default profile.`;

/**
 * The policy profiles of the preferences: the default profile picker, the list
 * of the shipped and user profiles, the rules and fallback level of the
 * profile chosen in the list, which the user edits for a user profile, and its
 * test box.
 */
export const PolicyProfileSettings = observer(() => {
  const store = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  const defaultProfile = findPolicyProfile(store.userProfiles, store.defaultProfileId) ?? STANDARD_PROFILE;
  const [selectedId, setSelectedId] = useState(defaultProfile.id);
  const [creating, setCreating] = useState(false);
  const [testCommandLine, setTestCommandLine] = useState("");

  const profiles: readonly PolicyProfile[] = [...SHIPPED_PROFILES, ...store.userProfiles];
  // A deleted profile leaves the default profile chosen.
  const selected = findPolicyProfile(store.userProfiles, selectedId) ?? defaultProfile;
  const profileOptions: SelectOption<string>[] = profiles.map((profile) => ({
    value: profile.id,
    label: profile.name,
  }));

  const create = (profile: PolicyProfile) => {
    addUserProfile(store, profile);
    setSelectedId(profile.id);
    setCreating(false);
  };

  const remove = (profile: PolicyProfile) => {
    if (!window.confirm(deleteQuestion(profile, profile.id === defaultProfile.id))) return;
    deleteUserProfile(store, profile.id);
  };

  return (
    <>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>Policy profiles</div>
        <Button primary label="New profile" onClick={() => setCreating(!creating)} />
      </div>
      <div className={styles.hint}>
        A policy profile decides what the agent may run on a cluster. Each rule gives the CLI invocations its command
        pattern matches a policy level, and the fallback level applies to the rest. When several rules match, the most
        specific one decides. Shipped profiles cannot be changed; duplicate one to make a variant.
      </div>
      {creating && <NewProfileForm profiles={profiles} onCreate={create} onCancel={() => setCreating(false)} />}

      <div className={styles.fieldLabel}>Default profile</div>
      <div className={styles.hint}>The policy profile of every cluster that has none of its own.</div>
      <div className={styles.defaultProfilePicker}>
        <Select
          aria-label="Default profile"
          options={profileOptions}
          value={defaultProfile.id}
          onChange={(option: SingleValue<SelectOption<string>>) => {
            if (option) setDefaultProfile(store, option.value);
          }}
          themeName="lens"
        />
      </div>

      <div className={styles.editor}>
        <ul aria-label="Policy profiles" className={styles.profileList}>
          {profiles.map((profile) => (
            <li key={profile.id}>
              <button
                type="button"
                className={styles.profileListItem}
                aria-current={profile.id === selected.id}
                onClick={() => setSelectedId(profile.id)}
              >
                <span className={styles.profileName}>{profile.name}</span>
                {SHIPPED_IDS.has(profile.id) && (
                  <span className={styles.tag} title="Shipped with Freelens AI, read-only">
                    Shipped
                  </span>
                )}
                {profile.id === defaultProfile.id && <span className={styles.tag}>Default</span>}
              </button>
            </li>
          ))}
        </ul>
        <ProfileDetails
          key={selected.id}
          profile={selected}
          shipped={SHIPPED_IDS.has(selected.id)}
          onChange={(profile) => replaceUserProfile(store, profile)}
          onDuplicate={() => create(copyPolicyProfile(selected, `Copy of ${selected.name}`))}
          onDelete={() => remove(selected)}
          testCommandLine={testCommandLine}
          onTestCommandLineChange={setTestCommandLine}
        />
      </div>
    </>
  );
});
