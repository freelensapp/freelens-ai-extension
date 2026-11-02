import { ShieldCheck } from "lucide-react";
import * as MobxReact from "mobx-react";
import { clusterPolicyProfile } from "../../../common/invocation-policy/profile-assignment";
import { PreferencesStore } from "../../../common/store";
import styles from "./cluster-profile-badge.module.scss";

const { observer } = MobxReact;

export interface ClusterProfileBadgeProps {
  clusterId: string;
}

/**
 * The name of the cluster's policy profile, for the chat header. It follows a
 * change of the assignment, the default profile or the profile itself at once.
 */
export const ClusterProfileBadge = observer(({ clusterId }: ClusterProfileBadgeProps) => {
  const profile = clusterPolicyProfile(PreferencesStore.getInstanceOrCreate<PreferencesStore>(), clusterId);

  return (
    <span
      className={styles.clusterProfileBadge}
      title={
        `Policy profile of this cluster: ${profile.name}. It decides which kubectl commands the agent runs, which ` +
        "wait for your approval and which are denied. Change it in the cluster's settings, on the Freelens AI tab."
      }
    >
      <ShieldCheck size={14} aria-hidden="true" />
      {profile.name}
    </span>
  );
});
