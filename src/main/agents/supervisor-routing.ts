// Recovers the supervisor's routing decision ({ reflection, goto }) from its
// raw response message.
//
// The supervisor binds a single `extract` tool that carries the structured
// routing decision. For thinking models (DeepSeek/Qwen) the tool is bound with
// `tool_choice: "auto"` because they reject a forced `tool_choice` while
// thinking. With `auto`, the model is free to skip the tool call: once it
// considers the user's query resolved it answers in plain text (typically
// ending with `__end__`) instead of calling `extract`. The structured parser
// then yields nothing and the run crashes with "the supervisor did not return a
// structured routing decision", even though the model clearly said `__end__`.
//
// To stay robust we first read the structured tool call, then fall back to the
// assistant text. Leaked tool-call markup is deliberately NOT recovered here -
// it means the endpoint lacks a server-side tool-call parser, which the caller
// surfaces with an actionable message instead of silently ending the run.

import { isAIMessage } from "@langchain/core/messages";
import { containsLeakedToolCallMarkup, messageContentToText } from "./leaked-tool-calls";

import type { BaseMessage } from "@langchain/core/messages";

// Name of the single structured-output tool bound for the supervisor. Matches
// the default `withStructuredOutput` function-calling tool name so the parser
// behaves identically across the forced and "auto" tool_choice paths.
export const SUPERVISOR_TOOL_NAME = "extract";

// The end-of-run sentinel used by both the supervisor schema and LangGraph.
export const END_DESTINATION = "__end__";

export interface SupervisorRouting {
  reflection: string;
  goto: string;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Find the sub-agent name mentioned earliest in the text as a standalone token.
// Sub-agent names are camelCase identifiers, so word boundaries avoid matching
// substrings inside unrelated words. Returns undefined when none is mentioned.
const findMentionedSubAgent = (text: string, subAgents: readonly string[]): string | undefined => {
  let best: string | undefined;
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const subAgent of subAgents) {
    const match = new RegExp(`\\b${escapeRegExp(subAgent)}\\b`).exec(text);
    if (match && match.index < bestIndex) {
      bestIndex = match.index;
      best = subAgent;
    }
  }
  return best;
};

// Extract routing from the structured `extract` tool call, when present and the
// `goto` is one of the known destinations. Returns undefined otherwise.
export const routingFromToolCall = (
  message: BaseMessage,
  destinations: readonly string[],
): SupervisorRouting | undefined => {
  if (!isAIMessage(message)) {
    return undefined;
  }
  const toolCall = message.tool_calls?.find((call) => call.name === SUPERVISOR_TOOL_NAME);
  const goto = toolCall?.args?.goto;
  if (typeof goto !== "string" || !destinations.includes(goto)) {
    return undefined;
  }
  const reflection = typeof toolCall?.args?.reflection === "string" ? toolCall.args.reflection : "";
  return { reflection, goto };
};

// Recover routing from a supervisor message that lacked a usable tool call by
// inspecting its text. A model that answered in prose has finished, so the
// default is `__end__`; an explicit sentinel or a named sub-agent overrides it.
// Returns undefined for empty text or leaked tool-call markup (the caller turns
// that into the actionable "missing server-side tool-call parser" error).
export const routingFromText = (message: BaseMessage, subAgents: readonly string[]): SupervisorRouting | undefined => {
  if (containsLeakedToolCallMarkup(message.content)) {
    return undefined;
  }
  const text = messageContentToText(message.content).trim();
  if (!text) {
    return undefined;
  }
  if (text.includes(END_DESTINATION)) {
    return { reflection: text, goto: END_DESTINATION };
  }
  return { reflection: text, goto: findMentionedSubAgent(text, subAgents) ?? END_DESTINATION };
};

// Resolve the supervisor's routing decision from its raw response message,
// preferring the structured tool call and falling back to the assistant text.
export const recoverSupervisorRouting = (
  message: BaseMessage,
  destinations: readonly string[],
  subAgents: readonly string[],
): SupervisorRouting | undefined => routingFromToolCall(message, destinations) ?? routingFromText(message, subAgents);
