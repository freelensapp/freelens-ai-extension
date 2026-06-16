// Detects tool-call markup that has leaked into assistant message *content*
// instead of being returned as a structured `tool_calls` field.
//
// This happens when an OpenAI-compatible endpoint serves a model whose native
// tool-call token format (for example DeepSeek's "DSML" / `<｜tool▁calls▁begin｜>`
// markup) is not parsed server-side. LangChain's `ChatOpenAI` only reads the
// OpenAI `tool_calls` field, so the raw tokens surface as plain text, no tool is
// ever invoked, and the tool-approval prompt never fires. Detecting it lets the
// agent fail with an actionable message instead of dumping raw markup to the UI.

import type { MessageContent } from "@langchain/core/messages";

// Shared, user-facing explanation for a leaked / missing structured tool call.
export const LEAKED_TOOL_CALL_MESSAGE =
  "The selected model returned tool-call markup as plain text instead of a structured tool call. " +
  "The OpenAI-compatible endpoint behind your base URL is likely missing a server-side tool-call parser " +
  "(for example vLLM `--enable-auto-tool-choice --tool-call-parser deepseek_v3`, or SGLang " +
  "`--tool-call-parser deepseek-v3`). You can also try enabling the 'Disable thinking' preference.";

const LEAKED_TOOL_CALL_PATTERNS: RegExp[] = [
  // DeepSeek "DSML" tool-call markup leaking as text, e.g. `<｜｜DSML｜｜tool_calls>`
  // or `<｜｜DSML｜｜invoke name="...">`. The bars are fullwidth (U+FF5C); tolerate
  // ASCII "|" too in case a provider normalizes them.
  /<\s*[｜|]{1,2}\s*DSML\s*[｜|]{1,2}/i,
  // DeepSeek native tool-call tokens, e.g. `<｜tool▁calls▁begin｜>` (the separator
  // is U+2581); tolerate "_" / whitespace variants.
  /<\s*[｜|]\s*tool[▁_\s]calls?[▁_\s]begin\s*[｜|]\s*>/i,
];

// Flatten LangChain message content (string or array of content parts) to text.
const toText = (content: MessageContent): string => {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("");
};

// True when the assistant content contains tool-call tokens that leaked as text.
export const containsLeakedToolCallMarkup = (content: MessageContent): boolean => {
  const text = toText(content);
  if (!text) {
    return false;
  }
  return LEAKED_TOOL_CALL_PATTERNS.some((pattern) => pattern.test(text));
};
