import { Command, Interrupt } from "@langchain/langgraph";
import { FreeLensAgent } from "../agent/freelens-agent-system";
import { MPCAgent } from "../agent/mcp-agent";
import { createStreamMergeState, extractReasoningText, mergeAiChunk } from "./stream-merge";

const MAX_GEMINI_STREAM_RETRIES = 3;
const BASE_BACKOFF_MS = 700;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isGeminiTransientError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("failed to parse stream") ||
    message.includes("503") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("429") ||
    message.includes("too many requests")
  );
};

const getRetryDelay = (attempt: number) => {
  const jitter = Math.floor(Math.random() * 250);

  return BASE_BACKOFF_MS * 2 ** (attempt - 1) + jitter;
};

// A streamed chunk carrying the model's reasoning ("chain-of-thought"). Kept
// distinct from the plain-string answer chunks so the UI can render it in a
// separate, dimmed, collapsible block.
export interface ReasoningChunk {
  reasoning: string;
}

export const isReasoningChunk = (chunk: unknown): chunk is ReasoningChunk =>
  typeof chunk === "object" &&
  chunk !== null &&
  "reasoning" in chunk &&
  typeof (chunk as ReasoningChunk).reasoning === "string";

export interface AgentService {
  run(
    agentInput: object | Command,
    conversationId: string,
  ): AsyncGenerator<string | ReasoningChunk | Interrupt, void, unknown>;
}

/**
 * This service takes an agent, runs it and streams the response back to the caller.
 * If the agent has any interrupts, it will yield those as well.
 * @returns
 * @param agent
 */
export const useAgentService = (agent: FreeLensAgent | MPCAgent): AgentService => {
  const run = async function* (agentInput: object | Command, conversationId: string) {
    console.log("Starting Agent Service run for message: ", agentInput);

    let config = { thread_id: conversationId };
    for (let attempt = 1; attempt <= MAX_GEMINI_STREAM_RETRIES + 1; attempt++) {
      let hasYieldedContent = false;
      // Tracks assistant message boundaries so distinct messages emitted within a
      // single run are separated by a blank line instead of being glued together.
      const mergeState = createStreamMergeState();

      try {
        const streamResponse = await agent.stream(agentInput, { streamMode: "messages", configurable: config });

        // streams LLM token by token to the UI
        for await (const [message, _metadata] of streamResponse) {
          // Always emit the assistant's text content, even when the same chunk
          // also carries tool calls. Some providers (e.g. DeepSeek via
          // DsmlAwareChatOpenAI) deliver the preamble text and the tool call in
          // a single chunk; dropping the whole chunk would hide the preamble the
          // model wrote before invoking a tool. Tool-call arguments live in
          // `tool_call_chunks`, not in `content`, so they are never emitted here.
          if (message.getType() === "ai") {
            // Surface the model's reasoning before its answer text. It streams
            // token by token in the same message; the UI concatenates the
            // deltas into a collapsible block.
            const reasoning = extractReasoningText(message.content, message.additional_kwargs);
            if (reasoning.length > 0) {
              hasYieldedContent = true;
              yield { reasoning };
            }

            const text = mergeAiChunk(mergeState, message.id, message.content);
            if (text.length > 0) {
              hasYieldedContent = true;
              yield text;
            }
          }
        }

        yield "\n";

        // checks the agent state for any interrupts
        const agentState = await agent.getState({ configurable: config });
        console.log("Agent state: ", agentState);
        if (agentState.next) {
          console.log("Agent state next: ", agentState.next);
          for (const task of agentState.tasks) {
            if (task.interrupts) {
              console.log("Agent state task interrupts: ", task.interrupts);
              for (const interrupt of task.interrupts) {
                console.log("Agent state task interrupt: ", interrupt);
                yield interrupt;
              }
            }
          }
        }

        return;
      } catch (error) {
        const canRetry = !hasYieldedContent && isGeminiTransientError(error) && attempt <= MAX_GEMINI_STREAM_RETRIES;

        if (!canRetry) {
          throw error;
        }

        await wait(getRetryDelay(attempt));
      }
    }
  };

  return { run };
};
