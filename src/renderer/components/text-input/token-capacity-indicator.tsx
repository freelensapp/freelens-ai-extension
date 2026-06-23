import * as React from "react";

type TokenCapacityIndicatorProps = {
  // Approximate size of the persisted conversation carried into the next prompt.
  // 0 at the start of a session. This is what the next prompt re-sends and what
  // the compaction decision acts on, so the gauge fills as the history grows and
  // nears 100% just before a compaction is triggered.
  usedTokens: number;
  // Max input tokens of the currently selected model.
  maxTokens: number;
  // Largest single LLM call's input tokens in the last run. A transient
  // intra-turn spike surfaced only in the tooltip, not used to size the gauge.
  peakTokens: number;
};

// Minimal circular progress indicator shown next to the send button. Renders a
// thin circle contour (a neutral dark grey for the unused capacity) with the
// progress arc drawn in a lighter grey for the used tokens, leaving the inside
// unfilled.
// 0% means the persisted conversation is empty (a fresh session); 100% means it
// reached the model's max input tokens and the next send will compact it.
export const TokenCapacityIndicator: React.FC<TokenCapacityIndicatorProps> = ({
  usedTokens,
  maxTokens,
  peakTokens,
}) => {
  const size = 22;
  const strokeWidth = 2;
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const fraction = maxTokens > 0 ? Math.min(1, Math.max(0, usedTokens / maxTokens)) : 0;
  const dashOffset = circumference * (1 - fraction);
  const percent = Math.round(fraction * 100);

  const contextLine =
    maxTokens > 0
      ? `Conversation context: ${usedTokens.toLocaleString("en-US")} / ${maxTokens.toLocaleString("en-US")} tokens (${percent}%)`
      : `Conversation context: ${usedTokens.toLocaleString("en-US")} tokens`;
  // Surface the transient peak separately so it is visible without driving the
  // gauge, which answers "max or last?": the gauge tracks the persisted context,
  // the tooltip reports the largest single request of the last turn.
  const title =
    peakTokens > 0
      ? `${contextLine}\nLargest single request last turn: ${peakTokens.toLocaleString("en-US")} tokens`
      : contextLine;

  return (
    <span className="text-input-token-capacity text-input-tooltip" data-tooltip={title}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title}>
        {/* Contour for the unused capacity, drawn in a neutral dark grey */}
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#616466" strokeWidth={strokeWidth} />
        {/* Progress arc for the used tokens, drawn in a lighter grey */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#a0a0a0"
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
