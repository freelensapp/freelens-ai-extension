// Formatting for the chat's token counter. The numbers come from pi's session
// stats in main; this only renders them, so it is unit-tested alone.

import type { SessionStats } from "../../../common/agent-protocol";

export interface TokenCounts {
  /** All input tokens, the cached ones included. */
  input: number;
  /** The part of `input` the provider served from its prompt cache. */
  cached: number;
  output: number;
}

/** pi counts cache reads and writes apart from the rest of the input; the counter shows them as input. */
export const tokenCounts = (tokens: SessionStats["tokens"] | undefined): TokenCounts => ({
  input: tokens ? tokens.input + tokens.cacheRead + tokens.cacheWrite : 0,
  cached: tokens?.cacheRead ?? 0,
  output: tokens?.output ?? 0,
});

/** `in:xxx (cached:zzz) + out:yyy`, with locale grouping so large totals stay readable. */
export const formatTokenCounts = (counts: TokenCounts): string => {
  const format = (value: number) => value.toLocaleString("en-US");
  return `in:${format(counts.input)} (cached:${format(counts.cached)}) + out:${format(counts.output)}`;
};

/** `$x.xx`; a sub-cent cost gets more decimals so it does not show as `$0.00`. */
export const formatCost = (cost: number): string =>
  cost > 0 && cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
