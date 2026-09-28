// Model-specific behavior is decided by heuristics on the model name instead of
// a hardcoded enum, so adding a new model needs no code changes. Extend the
// pattern table below when a new family needs different handling.

// OpenAI reasoning models (o-series, gpt-5.x) reject `temperature` and instead
// accept a `reasoningEffort`. Non-reasoning models are the inverse.
const REASONING_MODEL_PATTERNS: RegExp[] = [/^o\d/i, /gpt-5/i];

export const isReasoningModel = (modelName: string): boolean =>
  REASONING_MODEL_PATTERNS.some((pattern) => pattern.test(modelName));

export const supportsTemperature = (modelName: string): boolean => !isReasoningModel(modelName);
