import { FLOOR_ENTRIES } from "../../../../common/invocation-policy/floor";
import styles from "./policy-profiles.module.scss";

/** The floor of the invocation policy, read-only: each entry with its reason and what it rejects. */
export const FloorList = () => (
  <section aria-label="Floor" className={styles.floor}>
    <div className={styles.sectionTitle}>Floor</div>
    <div className={styles.hint}>
      The checks every CLI invocation must pass before its policy profile is asked. No profile can lift them: an
      invocation they reject never runs.
    </div>
    <ul aria-label="Floor entries" className={styles.floorList}>
      {Object.values(FLOOR_ENTRIES).map((entry) => (
        <li key={entry.id} className={styles.floorEntry}>
          <div className={styles.floorTitle}>{entry.title}</div>
          <div className={styles.floorReason}>{entry.reason}</div>
          <details className={styles.floorCovers}>
            <summary>What it rejects</summary>
            <ul>
              {entry.covers.map((covered) => (
                <li key={covered}>{covered}</li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  </section>
);
