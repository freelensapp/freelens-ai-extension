import * as React from "react";
import { AGENT_TOOLS } from "../../../common/agent-tools";
import styles from "./available-tools.module.scss";

// The first sentence of each description; the rest is guidance for the model.
const tools = AGENT_TOOLS.map((tool) => ({ name: tool.name, description: tool.description.split(/(?<=\.)\s/)[0] }));

export const AvailableTools: React.FC = () => {
  return (
    <div className={`text-input-vertical-list ${styles.availableTools}`}>
      <ul className={styles.availableToolsList}>
        {tools.map((item) => (
          <li key={item.name} className={styles.availableToolsItem}>
            <span className={styles.availableToolsInitial}>{item.name ? item.name.charAt(0).toUpperCase() : "?"}</span>
            <span>
              <strong>{item.name}</strong> - {item.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
