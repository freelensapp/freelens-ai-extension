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

// A single generation in a LangChain `LLMResult`. For chat models the rich
// usage lives on the generation's `message.usage_metadata`.
interface GenerationLike {
  message?: { usage_metadata?: unknown };
}

// The `LLMResult` shape passed to the `handleLLMEnd` callback. Only the fields
// we read are described.
interface LLMResultLike {
  generations?: GenerationLike[][];
  llmOutput?: {
    // Flat OpenAI-style usage some providers report instead of per-message
    // `usage_metadata` (no cache breakdown).
    tokenUsage?: { promptTokens?: number; completionTokens?: number };
  };
}

/**
 * Pull the token usage out of a LangChain `LLMResult` (the value passed to the
 * `handleLLMEnd` callback). Sums the per-message `usage_metadata` across every
 * generation, falling back to the flat `llmOutput.tokenUsage` when no message
 * carries `usage_metadata`. Returns `null` when no positive counts are found.
 *
 * Counting from the callback rather than the streamed chunks is what lets the
 * supervisor and analyzer turns - suppressed from the `messages` stream by the
 * `nostream` tag - be included in the per-session counter.
 */
export const extractTokenUsageFromLLMResult = (result: unknown): TokenUsage | null => {
  if (!result || typeof result !== "object") {
    return null;
  }

  const { generations, llmOutput } = result as LLMResultLike;

  let total = emptyTokenUsage();
  let found = false;

  if (Array.isArray(generations)) {
    for (const batch of generations) {
      if (!Array.isArray(batch)) {
        continue;
      }
      for (const generation of batch) {
        const usage = extractTokenUsage(generation?.message?.usage_metadata);
        if (usage) {
          total = addTokenUsage(total, usage);
          found = true;
        }
      }
    }
  }

  if (found) {
    return total;
  }

  const tokenUsage = llmOutput?.tokenUsage;
  if (tokenUsage) {
    const input = toCount(tokenUsage.promptTokens);
    const output = toCount(tokenUsage.completionTokens);
    if (input !== 0 || output !== 0) {
      return { input, cached: 0, output };
    }
  }

  return null;
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
