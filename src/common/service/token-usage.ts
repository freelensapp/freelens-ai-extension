// Pure helpers for the per-session token counter shown next to the model list.
//
// Kept free of host/MobX dependencies so the extraction and formatting logic can
// be unit-tested in isolation (see token-usage.test.ts).

// Running totals for a chat session. `cached` is the subset of `input` tokens
// the provider served from its prompt cache (a cache read). `cacheWrite`, when
// the provider reports it, is the subset of `input` tokens written to its
// prompt cache; it is absent from totals that never had one.
export interface TokenUsage {
  input: number;
  cached: number;
  output: number;
  cacheWrite?: number;
}

export const emptyTokenUsage = (): TokenUsage => ({ input: 0, cached: 0, output: 0 });

// The usage the AI SDK reports for a model call (`LanguageModelUsage`),
// described structurally so this module needs no model library. Only the fields
// we report are described; everything else is ignored.
export interface ModelUsageLike {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: {
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
  };
  // The usage as the provider sent it.
  raw?: unknown;
}

const toCount = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The cache write tokens of a call. The OpenAI-compatible provider of the AI SDK
// does not map them, so they are read from the raw usage too: LiteLLM reports
// them as `cache_creation_input_tokens`, as Anthropic does, or under
// `prompt_tokens_details.cache_creation_tokens`.
const cacheWriteTokens = (usage: ModelUsageLike): number => {
  const mapped = toCount(usage.inputTokenDetails?.cacheWriteTokens);
  if (mapped > 0 || !isRecord(usage.raw)) {
    return mapped;
  }
  const details = isRecord(usage.raw.prompt_tokens_details) ? usage.raw.prompt_tokens_details : {};
  return toCount(usage.raw.cache_creation_input_tokens) || toCount(details.cache_creation_tokens);
};

/**
 * The token usage of a model call, as the AI SDK reports it. Returns `null`
 * when the usage is absent or carries no positive counts, so callers can skip
 * a call that reported nothing.
 */
export const tokenUsageFromModelUsage = (usage: ModelUsageLike | undefined | null): TokenUsage | null => {
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const input = toCount(usage.inputTokens);
  const output = toCount(usage.outputTokens);
  const cached = toCount(usage.inputTokenDetails?.cacheReadTokens);
  const cacheWrite = cacheWriteTokens(usage);

  if (input === 0 && output === 0 && cached === 0 && cacheWrite === 0) {
    return null;
  }

  return cacheWrite > 0 ? { input, cached, output, cacheWrite } : { input, cached, output };
};

// Add a single model call's usage onto the running session totals. The cache
// write count is kept only once one of them has it.
export const addTokenUsage = (total: TokenUsage, delta: TokenUsage): TokenUsage => {
  const sum: TokenUsage = {
    input: total.input + delta.input,
    cached: total.cached + delta.cached,
    output: total.output + delta.output,
  };
  if (total.cacheWrite !== undefined || delta.cacheWrite !== undefined) {
    sum.cacheWrite = (total.cacheWrite ?? 0) + (delta.cacheWrite ?? 0);
  }
  return sum;
};

// True when every field is zero, so callers can skip emitting an empty delta.
export const isEmptyTokenUsage = (usage: TokenUsage): boolean =>
  usage.input === 0 && usage.cached === 0 && usage.output === 0 && !usage.cacheWrite;

/**
 * Render the session totals as the compact counter requested in the issue:
 * `in:xxx (cached:zzz) + out:yyy`. Counts use locale grouping so large totals
 * stay readable.
 */
export const formatTokenUsage = (usage: TokenUsage): string => {
  const format = (value: number) => value.toLocaleString("en-US");
  return `in:${format(usage.input)} (cached:${format(usage.cached)}) + out:${format(usage.output)}`;
};
