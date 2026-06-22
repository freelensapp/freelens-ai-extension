// Pure helpers for the per-session token counter shown next to the model list.
//
// Kept free of host/MobX dependencies so the extraction and formatting logic can
// be unit-tested in isolation (see token-usage.test.ts).

// Running totals for a chat session. `cached` is the subset of `input` tokens
// the provider served from its prompt cache (LangChain's
// `input_token_details.cache_read`).
export interface TokenUsage {
  input: number;
  cached: number;
  output: number;
}

export const emptyTokenUsage = (): TokenUsage => ({ input: 0, cached: 0, output: 0 });

// The `usage_metadata` shape LangChain attaches to AI messages. Only the fields
// we report are described; everything else is ignored.
interface UsageMetadataLike {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: {
    cache_read?: number;
  };
}

const toCount = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Pull the input/cached/output token counts out of a LangChain
 * `usage_metadata` record. Returns `null` when the record is absent or carries
 * no positive counts, so callers can skip empty streamed chunks (every chunk
 * before the final one of a model turn has no usage).
 */
export const extractTokenUsage = (usageMetadata: unknown): TokenUsage | null => {
  if (!usageMetadata || typeof usageMetadata !== "object") {
    return null;
  }

  const metadata = usageMetadata as UsageMetadataLike;
  const input = toCount(metadata.input_tokens);
  const output = toCount(metadata.output_tokens);
  const cached = toCount(metadata.input_token_details?.cache_read);

  if (input === 0 && output === 0 && cached === 0) {
    return null;
  }

  return { input, cached, output };
};

// Add a single model turn's usage onto the running session totals.
export const addTokenUsage = (total: TokenUsage, delta: TokenUsage): TokenUsage => ({
  input: total.input + delta.input,
  cached: total.cached + delta.cached,
  output: total.output + delta.output,
});

/**
 * Render the session totals as the compact counter requested in the issue:
 * `in:xxx (cached:zzz) + out:yyy`. Counts use locale grouping so large totals
 * stay readable.
 */
export const formatTokenUsage = (usage: TokenUsage): string => {
  const format = (value: number) => value.toLocaleString("en-US");
  return `in:${format(usage.input)} (cached:${format(usage.cached)}) + out:${format(usage.output)}`;
};
