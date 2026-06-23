import * as React from "react";

type TokenCapacityIndicatorProps = {
  // Input tokens of the last request to the LLM. 0 at the start of a session.
  usedTokens: number;
  // Max input tokens of the currently selected model.
  maxTokens: number;
};

// Minimal circular progress indicator shown next to the send button. Renders a
// thin circle contour (matching the send button's size and colour) with the
// progress arc drawn in the standard text colour, leaving the inside unfilled.
// 0% means no tokens were used in the last request (or a fresh session); 100%
// means the last request reached the model's max input tokens.
export const TokenCapacityIndicator: React.FC<TokenCapacityIndicatorProps> = ({ usedTokens, maxTokens }) => {
  const size = 22;
  const strokeWidth = 2;
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const fraction = maxTokens > 0 ? Math.min(1, Math.max(0, usedTokens / maxTokens)) : 0;
  const dashOffset = circumference * (1 - fraction);
  const percent = Math.round(fraction * 100);

  const title =
    maxTokens > 0
      ? `Input tokens in last request: ${usedTokens.toLocaleString("en-US")} / ${maxTokens.toLocaleString("en-US")} (${percent}%)`
      : `Input tokens in last request: ${usedTokens.toLocaleString("en-US")}`;

  return (
    <span className="text-input-token-capacity text-input-tooltip" data-tooltip={title}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={title}>
        {/* Contour, drawn in a neutral grey */}
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#acacac" strokeWidth={strokeWidth} />
        {/* Progress arc, drawn in the standard text colour */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--textColorPrimary)"
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
