// Runs an agent on a conversation and turns the parts of its AI SDK stream into
// the events of the bridge (see AgentRunEvent):
//
// - `text` and `reasoning`: the answer and the model's reasoning, as they are
//   generated. A blank line separates two text blocks of a run, such as the
//   text before a tool call and the answer after it.
// - `usage`: the token usage of every model call, as a delta for the session
//   counter, emitted when the call ends, so the counter moves during a turn.
// - `context`: the size of the conversation the next request re-sends: its
//   approximate text plus the measured fixed overhead of a request (the
//   instructions, the tool schemas, the structure of tool calls), which is the
//   largest difference between the real input of a call and the estimate of
//   the messages sent with it. `peakInputTokens` is the largest single call of
//   the run, for the tooltip of the capacity indicator.
// - `interrupt`: the approval the run ended with, when a tool call waits on it.

import { type AgentRunEvent } from "../../common/bridge/protocol";
import { tokenUsageFromModelUsage } from "../../common/service/token-usage";
import { approximateConversationTokens } from "./conversation";
import {
  buildUnsupportedToolCallMessage,
  containsLeakedToolCallMarkup,
  LEAKED_TOOL_CALL_MESSAGE,
} from "./leaked-tool-calls";

import type { ModelMessage, TextStreamPart, ToolSet } from "ai";

import type { ChatAgent, ToolCallToApprove } from "./agents";

// What a run yields; `done` and `error` are the bridge's.
export type AgentServiceEvent = Exclude<AgentRunEvent, { type: "done" } | { type: "error" }>;

// The part of an AI SDK stream result that a run reads.
export interface AgentStream {
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>;
  responseMessages: PromiseLike<ModelMessage[]>;
}

export interface AgentRunOptions {
  agent: ChatAgent;
  // The conversation the run continues, the new prompt or the answers of the
  // pending approvals included.
  messages: ModelMessage[];
  // Aborted when the caller closes the run's stream or the extension stops; it
  // reaches the model call and the tools.
  signal: AbortSignal;
  // Stores the conversation once the run ended, with the response messages.
  save(messages: ModelMessage[]): void;
}

const errorOf = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

export async function* runAgent({ agent, messages, signal, save }: AgentRunOptions): AsyncGenerator<AgentServiceEvent> {
  // The estimate of the messages sent with the current model call, set when the
  // call starts, to measure its fixed overhead when it ends.
  let approximateInput = approximateConversationTokens(messages);
  let requestOverhead = 0;
  let peakInputTokens = 0;
  let hasText = false;
  let separateNextText = false;
  let stepText = "";
  const toolCallsToApprove: ToolCallToApprove[] = [];

  const result = await agent.stream({
    messages,
    signal,
    onStepStart: (stepMessages) => {
      approximateInput = approximateConversationTokens(stepMessages);
    },
  });

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-start":
        separateNextText = hasText;
        break;
      case "text-delta":
        if (part.text.length > 0) {
          if (separateNextText) {
            separateNextText = false;
            yield { type: "text", text: "\n\n" };
          }
          hasText = true;
          stepText += part.text;
          yield { type: "text", text: part.text };
        }
        break;
      case "reasoning-delta":
        if (part.text.length > 0) {
          yield { type: "reasoning", reasoning: part.text };
        }
        break;
      case "tool-approval-request":
        if (!part.isAutomatic) {
          toolCallsToApprove.push({ toolName: part.toolCall.toolName, input: part.toolCall.input });
        }
        break;
      // A call of a tool the agent does not have, such as a shell command,
      // ends the run with an explanation rather than reaching the model as a
      // tool error that it summarizes into a confusing answer.
      case "tool-error":
        if (!agent.toolNames.has(part.toolName)) {
          throw new Error(buildUnsupportedToolCallMessage([part.toolName]));
        }
        break;
      case "finish-step": {
        // Tool-call markup the provider did not parse, which the DSML
        // middleware could not recover either.
        if (containsLeakedToolCallMarkup(stepText)) {
          throw new Error(LEAKED_TOOL_CALL_MESSAGE);
        }
        stepText = "";
        const usage = tokenUsageFromModelUsage(part.usage);
        if (usage) {
          peakInputTokens = Math.max(peakInputTokens, usage.input);
          requestOverhead = Math.max(requestOverhead, usage.input - approximateInput);
          yield { type: "usage", tokenUsage: usage };
        }
        yield { type: "context", contextTokens: approximateInput + requestOverhead, peakInputTokens };
        break;
      }
      case "error":
        throw errorOf(part.error);
      case "abort":
        throw signal.aborted ? errorOf(signal.reason) : new Error("The run was aborted.");
    }
  }

  const conversation = [...messages, ...(await result.responseMessages)];
  save(conversation);

  yield { type: "text", text: "\n" };
  // The final reading: the stored conversation is what the next prompt
  // re-sends, and what the compaction decision acts on.
  yield {
    type: "context",
    contextTokens: approximateConversationTokens(conversation) + requestOverhead,
    peakInputTokens,
  };

  if (toolCallsToApprove.length > 0) {
    yield { type: "interrupt", value: await agent.describeApprovals(toolCallsToApprove) };
  }
}
