// Model-specific behavior is decided by heuristics on the model name instead of
// a hardcoded enum, so adding a new model needs no code changes. Extend the
// pattern table below when a new family needs different handling.

// OpenAI reasoning models (o-series, gpt-5.x) reject `temperature` and instead
// accept a `reasoningEffort`. Non-reasoning models are the inverse.
const REASONING_MODEL_PATTERNS: RegExp[] = [/^o\d/i, /gpt-5/i];

export const isReasoningModel = (modelName: string): boolean =>
  REASONING_MODEL_PATTERNS.some((pattern) => pattern.test(modelName));

export const supportsTemperature = (modelName: string): boolean => !isReasoningModel(modelName);

// Turning a model's "thinking"/reasoning mode off is provider-specific: there is
// no shared OpenAI field for it, so each family expects a different extra payload
// merged into the request body (passed through verbatim by gateways like
// LiteLLM). The matchers below map a model name to the vendor-specific kwargs
// that disable thinking. Order matters — the first matching rule wins.
const DISABLE_THINKING_RULES: { pattern: RegExp; kwargs: Record<string, unknown> }[] = [
  // DeepSeek (e.g. deepseek-v4-pro/flash, deepseek-reasoner). The official
  // OpenAI-compatible API disables thinking via a top-level `thinking` object,
  // while self-hosted deployments (vLLM/SGLang) use a chat-template flag. Send
  // both so the request works regardless of how the model is served.
  {
    pattern: /deepseek/i,
    kwargs: { thinking: { type: "disabled" }, chat_template_kwargs: { thinking: false } },
  },
  // Qwen 3 toggles reasoning with `enable_thinking` in its chat template.
  { pattern: /qwen/i, kwargs: { chat_template_kwargs: { enable_thinking: false } } },
  // Anthropic Claude uses the typed `thinking` object.
  { pattern: /claude/i, kwargs: { thinking: { type: "disabled" } } },
  // Google Gemini disables reasoning via a "none" reasoning effort.
  { pattern: /gemini/i, kwargs: { reasoning_effort: "none" } },
];

// Returns the vendor-specific kwargs that disable thinking for the given model,
// or null when no known family matches (so nothing provider-specific is sent and
// gateways that reject unknown fields are not tripped).
export const buildDisableThinkingKwargs = (modelName: string): Record<string, unknown> | null =>
  DISABLE_THINKING_RULES.find((rule) => rule.pattern.test(modelName))?.kwargs ?? null;
