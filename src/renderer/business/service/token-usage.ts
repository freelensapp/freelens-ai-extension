// Pure helpers for the per-session token counter shown next to the model list.
//
// Kept free of host/MobX dependencies so the arithmetic and formatting logic can
// be unit-tested in isolation (see token-usage.test.ts).

// Running totals for a chat session. `cached` is the subset of `input` tokens
// the provider served from its prompt cache (Strands' `cacheReadInputTokens`).
export interface TokenUsage {
  input: number;
  cached: number;
  output: number;
}

export const emptyTokenUsage = (): TokenUsage => ({ input: 0, cached: 0, output: 0 });

// Add a single model turn's usage onto the running session totals.
export const addTokenUsage = (total: TokenUsage, delta: TokenUsage): TokenUsage => ({
  input: total.input + delta.input,
  cached: total.cached + delta.cached,
  output: total.output + delta.output,
});

// True when every field is zero, so callers can skip emitting an empty delta.
export const isEmptyTokenUsage = (usage: TokenUsage): boolean =>
  usage.input === 0 && usage.cached === 0 && usage.output === 0;

/**
 * Render the session totals as the compact counter requested in the issue:
 * `in:xxx (cached:zzz) + out:yyy`. Counts use locale grouping so large totals
 * stay readable.
 */
export const formatTokenUsage = (usage: TokenUsage): string => {
  const format = (value: number) => value.toLocaleString("en-US");
  return `in:${format(usage.input)} (cached:${format(usage.cached)}) + out:${format(usage.output)}`;
};
