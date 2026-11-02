import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { defaultPolicyProfile, findPolicyProfile } from "../../../common/invocation-policy/profile-assignment";
import { SHIPPED_PROFILES } from "../../../common/invocation-policy/shipped-profiles";
import { PreferencesStore } from "../../../common/store";

import type { SingleValue } from "react-select";

const { observer } = MobxReact;

const {
  Component: { Select },
} = Renderer;

type SelectOption<T> = Renderer.Component.SelectOption<T>;

/** The value of the option that removes the cluster's assignment, so that the cluster follows the default profile. */
const FOLLOW_DEFAULT_PROFILE = "";

export interface ClusterProfilePickerProps {
  clusterId: string;
  /** Names the picker for assistive technology. */
  clusterName: string;
}

/**
 * Picks the policy profile of a cluster: the default profile, which removes the
 * cluster's assignment, or a shipped or user profile. It replaces
 * `profileAssignments` as a whole, which lets main check the pending approvals
 * again.
 */
export const ClusterProfilePicker = observer(({ clusterId, clusterName }: ClusterProfilePickerProps) => {
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  const { userProfiles, profileAssignments } = preferencesStore;

  const options: SelectOption<string>[] = [
    { value: FOLLOW_DEFAULT_PROFILE, label: `Default profile (${defaultPolicyProfile(preferencesStore).name})` },
    ...[...SHIPPED_PROFILES, ...userProfiles].map((profile) => ({ value: profile.id, label: profile.name })),
  ];
  const assignedId = profileAssignments[clusterId];
  const value =
    assignedId !== undefined && findPolicyProfile(userProfiles, assignedId) ? assignedId : FOLLOW_DEFAULT_PROFILE;

  const assign = (option: SingleValue<SelectOption<string>>) => {
    if (!option) return;
    const { [clusterId]: _previous, ...otherAssignments } = preferencesStore.profileAssignments;
    preferencesStore.profileAssignments =
      option.value === FOLLOW_DEFAULT_PROFILE ? otherAssignments : { ...otherAssignments, [clusterId]: option.value };
  };

  return (
    <Select
      id={`cluster-profile-${clusterId}`}
      aria-label={`Policy profile of ${clusterName}`}
      options={options}
      value={value}
      onChange={assign}
      themeName="lens"
    />
  );
});
