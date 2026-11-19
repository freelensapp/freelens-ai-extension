// Detects tool-call markup that has leaked into the assistant *text* instead of
// being returned as a structured tool call.
//
// This happens when an OpenAI-compatible endpoint serves a model whose native
// tool-call token format (for example DeepSeek's "DSML" / `<｜tool▁calls▁begin｜>`
// markup) is not parsed server-side. The provider only reads the OpenAI
// `tool_calls` field, so the raw tokens surface as plain text, no tool is ever
// invoked, and the tool-approval prompt never fires. Detecting it lets the
// agent fail with an actionable message instead of dumping raw markup to the UI.

import { type MessageContent, messageContentToText } from "../../common/provider/token-estimate";

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

// True when the assistant content contains tool-call tokens that leaked as text.
export const containsLeakedToolCallMarkup = (content: MessageContent): boolean => {
  const text = messageContentToText(content);
  if (!text) {
    return false;
  }
  return LEAKED_TOOL_CALL_PATTERNS.some((pattern) => pattern.test(text));
};

// ---------------------------------------------------------------------------
// DSML tool-call recovery
// ---------------------------------------------------------------------------
//
// DeepSeek's "DSML" markup mirrors the Anthropic-style function-calling XML,
// namespaced with `｜｜DSML｜｜` (bars are fullwidth U+FF5C). When the endpoint
// does not parse it server-side it surfaces verbatim in the assistant text, for
// example:
//
//   <｜｜DSML｜｜tool_calls>
//     <｜｜DSML｜｜invoke name="listKubernetesResources">
//       <｜｜DSML｜｜parameter name="kind" string="true">Pod</｜｜DSML｜｜parameter>
//     </｜｜DSML｜｜invoke>
//   </｜｜DSML｜｜tool_calls>
//
// Recovering these into structured tool calls (see dsml-middleware.ts) lets the
// agent execute the tools instead of dumping the raw markup to the UI. The
// native token format (`<｜tool▁calls▁begin｜>`) carries no parseable arguments,
// so it is left for the `containsLeakedToolCallMarkup` guard to report.

// Namespace fragment shared by every DSML tag: one or two bars, "DSML", one or
// two bars. Tolerates ASCII "|" and surrounding whitespace.
const DSML_NS = String.raw`[｜|]{1,2}\s*DSML\s*[｜|]{1,2}`;

// A single `<｜｜DSML｜｜invoke name="...">...</｜｜DSML｜｜invoke>` block.
const DSML_INVOKE_BLOCK = new RegExp(
  String.raw`<\s*${DSML_NS}\s*invoke\b[^>]*?\bname\s*=\s*"([^"]*)"[^>]*?>([\s\S]*?)<\s*/\s*${DSML_NS}\s*invoke\s*>`,
  "gi",
);

// A single `<｜｜DSML｜｜parameter name="..." [string="true"]>value</｜｜DSML｜｜parameter>`.
const DSML_PARAMETER = new RegExp(
  String.raw`<\s*${DSML_NS}\s*parameter\b([^>]*?)>([\s\S]*?)<\s*/\s*${DSML_NS}\s*parameter\s*>`,
  "gi",
);

// Any DSML tag (open or close), used to strip leftover wrappers from the text.
const DSML_ANY_TAG = new RegExp(String.raw`<\s*/?\s*${DSML_NS}[^>]*>`, "gi");

const PARAM_NAME_ATTR = /\bname\s*=\s*"([^"]*)"/i;
// DeepSeek marks a literal-string argument with `string="true"`; otherwise the
// value is JSON (number, boolean, object, array).
const PARAM_STRING_ATTR = /\bstring\s*=\s*"?\s*true\s*"?/i;

const parseParamValue = (rawValue: string, isString: boolean): unknown => {
  const value = rawValue.trim();
  if (isString) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

// A tool call recovered from the markup. The caller gives it an id that is
// unique in the conversation.
export interface DsmlToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ParsedDsmlToolCalls {
  // The assistant text with all DSML markup removed (trimmed).
  cleanedText: string;
  // Structured tool calls recovered from the markup (empty when none found).
  toolCalls: DsmlToolCall[];
}

// Parse DeepSeek DSML tool-call markup out of assistant content. Returns the
// recovered tool calls and the text with the markup stripped. When no DSML
// `invoke` block is present, `toolCalls` is empty and `cleanedText` is the
// original text (trimmed).
export const parseDsmlToolCalls = (content: MessageContent): ParsedDsmlToolCalls => {
  const text = messageContentToText(content);
  const toolCalls: DsmlToolCall[] = [];

  if (!text) {
    return { cleanedText: "", toolCalls };
  }

  for (const invokeMatch of text.matchAll(DSML_INVOKE_BLOCK)) {
    const name = invokeMatch[1]?.trim();
    const body = invokeMatch[2] ?? "";
    if (!name) {
      continue;
    }

    const args: Record<string, unknown> = {};
    for (const paramMatch of body.matchAll(DSML_PARAMETER)) {
      const attrs = paramMatch[1] ?? "";
      const nameAttr = attrs.match(PARAM_NAME_ATTR);
      if (!nameAttr) {
        continue;
      }
      args[nameAttr[1]] = parseParamValue(paramMatch[2] ?? "", PARAM_STRING_ATTR.test(attrs));
    }

    toolCalls.push({ name, args });
  }

  if (toolCalls.length === 0) {
    return { cleanedText: text.trim(), toolCalls };
  }

  const cleanedText = text.replace(DSML_INVOKE_BLOCK, "").replace(DSML_ANY_TAG, "").trim();
  return { cleanedText, toolCalls };
};

// ---------------------------------------------------------------------------
// Unsupported / hallucinated tool calls
// ---------------------------------------------------------------------------
//
// The model may request a tool that does not exist in the extension, for
// example a shell-style `runCommand` (no command-execution capability is
// implemented). The AI SDK answers such a call with a tool error that the model
// would summarize into a confusing result, so the agent fails with an
// actionable explanation instead (see agent-service.ts).

// Shared, user-facing explanation for an unsupported tool call.
export const UNSUPPORTED_TOOL_CALL_MESSAGE =
  "Running shell commands or other CLI tools (kubectl, helm, etc.) is not supported yet; " +
  "only the built-in Kubernetes tools are available.";

// Build the actionable message naming the unsupported tool(s) the model tried
// to use.
export const buildUnsupportedToolCallMessage = (toolNames: string[]): string => {
  const names = toolNames.map((name) => `\`${name}\``).join(", ");
  const subject = toolNames.length === 1 ? "an unsupported tool" : "unsupported tools";
  return `The model tried to use ${subject} (${names}). ${UNSUPPORTED_TOOL_CALL_MESSAGE}`;
};
