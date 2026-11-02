import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { ClusterProfilePicker } from "./cluster-profile-picker";
import styles from "./cluster-profile-table.module.scss";

const { observer } = MobxReact;

/**
 * Every cluster Freelens knows, by name, with a picker of its policy profile,
 * for the preferences. The host's catalog is observable, so a cluster added or
 * renamed shows at once.
 */
export const ClusterProfileTable = observer(() => {
  const clusters = Renderer.Catalog.getAllClusters().toSorted((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className={styles.title}>Cluster profiles</div>
      <div className={styles.description}>
        The policy profile of each cluster decides which kubectl commands the agent runs, which wait for your approval
        and which are denied. A cluster on the default profile follows it when the default changes. Each cluster's
        settings have the same picker, on the Freelens AI tab.
      </div>
      {clusters.length === 0 ? (
        <div className={styles.empty}>No clusters yet. A cluster added to the Freelens catalog appears here.</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Cluster</th>
              <th scope="col">Policy profile</th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((cluster) => (
              <tr key={cluster.id}>
                <td className={styles.clusterName}>{cluster.name}</td>
                <td className={styles.profile}>
                  <ClusterProfilePicker clusterId={cluster.id} clusterName={cluster.name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
});
