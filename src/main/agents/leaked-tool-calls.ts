// Detects tool-call markup that has leaked into assistant message *content*
// instead of being returned as a structured `tool_calls` field.
//
// This happens when an OpenAI-compatible endpoint serves a model whose native
// tool-call token format (for example DeepSeek's "DSML" / `<｜tool▁calls▁begin｜>`
// markup) is not parsed server-side. LangChain's `ChatOpenAI` only reads the
// OpenAI `tool_calls` field, so the raw tokens surface as plain text, no tool is
// ever invoked, and the tool-approval prompt never fires. Detecting it lets the
// agent fail with an actionable message instead of dumping raw markup to the UI.

import { AIMessage, isAIMessage } from "@langchain/core/messages";

import type { BaseMessage, MessageContent } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";

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

// Public alias: flatten LangChain message content to plain text. Reused by the
// supervisor routing recovery to scan assistant text for a routing decision.
export const messageContentToText = (content: MessageContent): string => toText(content);

// True when the assistant content contains tool-call tokens that leaked as text.
export const containsLeakedToolCallMarkup = (content: MessageContent): boolean => {
  const text = toText(content);
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
// Recovering these into structured `tool_calls` lets the agent graph execute the
// tools instead of dumping the raw markup to the UI. The native token format
// (`<｜tool▁calls▁begin｜>`) carries no parseable arguments, so it is left for the
// `containsLeakedToolCallMarkup` guard to report.

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

export interface ParsedDsmlToolCalls {
  // The assistant text with all DSML markup removed (trimmed).
  cleanedText: string;
  // Structured tool calls recovered from the markup (empty when none found).
  toolCalls: ToolCall[];
}

// Parse DeepSeek DSML tool-call markup out of assistant content. Returns the
// recovered tool calls and the text with the markup stripped. When no DSML
// `invoke` block is present, `toolCalls` is empty and `cleanedText` is the
// original text (trimmed).
export const parseDsmlToolCalls = (content: MessageContent): ParsedDsmlToolCalls => {
  const text = toText(content);
  const toolCalls: ToolCall[] = [];

  if (!text) {
    return { cleanedText: "", toolCalls };
  }

  let index = 0;
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

    toolCalls.push({ name, args, id: `dsml_tool_call_${index}`, type: "tool_call" });
    index++;
  }

  if (toolCalls.length === 0) {
    return { cleanedText: text.trim(), toolCalls };
  }

  const cleanedText = text.replace(DSML_INVOKE_BLOCK, "").replace(DSML_ANY_TAG, "").trim();
  return { cleanedText, toolCalls };
};

// When an assistant message carries DSML tool-call markup in its text but no
// structured `tool_calls`, return a new message with the tool calls recovered
// and the markup stripped. Messages that already have structured tool calls, or
// that contain no recoverable DSML markup, are returned unchanged.
export const recoverDsmlToolCalls = (message: BaseMessage): BaseMessage => {
  if (!isAIMessage(message) || (message.tool_calls && message.tool_calls.length > 0)) {
    return message;
  }

  const { cleanedText, toolCalls } = parseDsmlToolCalls(message.content);
  if (toolCalls.length === 0) {
    return message;
  }

  return new AIMessage({
    id: message.id,
    content: cleanedText,
    tool_calls: toolCalls,
    invalid_tool_calls: message.invalid_tool_calls,
    additional_kwargs: message.additional_kwargs,
    response_metadata: message.response_metadata,
    usage_metadata: message.usage_metadata,
    name: message.name,
  });
};

// ---------------------------------------------------------------------------
// Unsupported / hallucinated tool calls
// ---------------------------------------------------------------------------
//
// The model may request a tool that does not exist in the extension, for
// example a shell-style `runCommand` (no command-execution capability is
// implemented). Such a call can arrive as a structured `tool_calls` entry or be
// recovered from DSML markup; either way `ToolNode` only answers with a generic
// "Tool not found" message that the agent then summarizes into a confusing
// result. Detecting unknown tool names lets the agent fail with an actionable
// explanation instead.

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

// Return the de-duplicated names of any tool calls in the given messages whose
// name is not part of `knownToolNames`. Empty when every requested tool is known
// (or no tool calls are present).
export const findUnknownToolCalls = (messages: BaseMessage[], knownToolNames: Iterable<string>): string[] => {
  const known = new Set(knownToolNames);
  const unknown = new Set<string>();
  for (const message of messages) {
    if (!isAIMessage(message) || !message.tool_calls) {
      continue;
    }
    for (const toolCall of message.tool_calls) {
      if (toolCall.name && !known.has(toolCall.name)) {
        unknown.add(toolCall.name);
      }
    }
  }
  return [...unknown];
};
