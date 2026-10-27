import styles from "./text-input.module.scss";

import type { FC } from "react";

type TokenCapacityIndicatorProps = {
  // pi's estimate of the context the next prompt sends, from the chat's stats.
  // Null when pi does not know it yet: right after a compaction, until the next
  // answer.
  usedTokens: number | null;
  // The context window of the chat's model.
  maxTokens: number;
};

// Minimal circular progress indicator shown next to the send button. Renders a
// thin circle contour for the unused capacity with the progress arc drawn for
// the used tokens, leaving the inside unfilled. The stroke colours are
// theme-aware and driven from SCSS (see `text-input.module.scss`).
// 0% means the context is empty (a new chat); pi compacts the chat on its own
// when it gets close to 100%.
export const TokenCapacityIndicator: FC<TokenCapacityIndicatorProps> = ({ usedTokens, maxTokens }) => {
  const size = 22;
  const strokeWidth = 2;
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const used = usedTokens ?? 0;
  const fraction = maxTokens > 0 ? Math.min(1, Math.max(0, used / maxTokens)) : 0;
  const dashOffset = circumference * (1 - fraction);
  const percent = Math.round(fraction * 100);

  const title =
    usedTokens === null
      ? "Conversation context: unknown until the next answer, because the conversation was just compacted"
      : maxTokens > 0
        ? `Conversation context: ${used.toLocaleString("en-US")} / ${maxTokens.toLocaleString("en-US")} tokens (${percent}%)`
        : `Conversation context: ${used.toLocaleString("en-US")} tokens`;

  return (
    <span className={`${styles.textInputTokenCapacity} ${styles.textInputTooltip}`} data-tooltip={title}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title}>
        {/* Contour for the unused capacity; colour is theme-aware (see SCSS) */}
        <circle
          className={styles.textInputTokenCapacityTrack}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc for the used tokens; colour is theme-aware (see SCSS) */}
        <circle
          className={styles.textInputTokenCapacityArc}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
    </span>
  );
};
