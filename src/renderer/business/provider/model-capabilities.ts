// Model-specific behavior is decided by heuristics on the model name instead of
// a hardcoded enum, so adding a new model needs no code changes. Extend the
// pattern table below when a new family needs different handling.

// OpenAI reasoning models (o-series, gpt-5.x) reject `temperature` and instead
// accept a `reasoningEffort`. Non-reasoning models are the inverse.
const REASONING_MODEL_PATTERNS: RegExp[] = [/^o\d/i, /gpt-5/i];

export const isReasoningModel = (modelName: string): boolean =>
  REASONING_MODEL_PATTERNS.some((pattern) => pattern.test(modelName));

export const supportsTemperature = (modelName: string): boolean => !isReasoningModel(modelName);

// Some "thinking" models (notably DeepSeek served through LiteLLM/OpenAI-compat
// gateways, and Qwen reasoning models) reject a *forced* `tool_choice` while
// thinking mode is on, failing with
// `Thinking mode does not support this tool_choice`. They only accept
// `tool_choice: "auto"` (or none). The supervisor binds a single structured
// output tool and normally forces it; for these families it must request
// `auto` instead so the request is accepted. Extend the pattern list when a new
// family is found to have the same constraint.
const FORCED_TOOL_CHOICE_UNSUPPORTED_PATTERNS: RegExp[] = [/deepseek/i, /qwen/i];

export const requiresAutoToolChoice = (modelName: string): boolean =>
  FORCED_TOOL_CHOICE_UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(modelName));

// DeepSeek models emit native tool calls in their "DSML" markup
// (`<｜｜DSML｜｜invoke name="...">`). OpenAI-compatible endpoints that lack a
// server-side tool-call parser leak this markup into the assistant text instead
// of returning structured `tool_calls`, so no tool ever runs. For these models
// we use a client that recovers the tool calls from the markup (see
// `dsml-aware-chat-model.ts`). Extend the pattern list when another family is
// found to emit the same markup.
const DSML_TOOL_CALL_PATTERNS: RegExp[] = [/deepseek/i];

export const emitsDsmlToolCalls = (modelName: string): boolean =>
  DSML_TOOL_CALL_PATTERNS.some((pattern) => pattern.test(modelName));
